/**
 * PDF export utility for VisionKinetix session reports.
 *
 * Uses html2canvas to snapshot a DOM node, then jsPDF to embed it
 * as a multi-page A4 portrait PDF. Designed to work regardless of
 * theme (forces a dark background to match the report aesthetic).
 */
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 8;

/**
 * Snapshot `node` and export as a multi-page A4 PDF.
 * @param {HTMLElement} node - element to capture
 * @param {string} filename - output filename (without extension)
 * @param {object} opts
 * @param {string} [opts.background="#0a0a0a"] - canvas background color
 */
export async function exportNodeToPdf(node, filename, opts = {}) {
  if (!node) throw new Error("No node provided to exportNodeToPdf");
  const background = opts.background || "#0a0a0a";

  // Briefly force dark surface so the snapshot looks consistent
  // regardless of the current theme.
  const html = document.documentElement;
  const hadLight = html.classList.contains("light");
  if (hadLight) html.classList.remove("light");

  // Allow the browser one tick to repaint after class swap
  await new Promise((r) => requestAnimationFrame(() => r()));

  let canvas;
  try {
    canvas = await html2canvas(node, {
      backgroundColor: background,
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
      logging: false,
      windowWidth: node.scrollWidth,
      windowHeight: node.scrollHeight,
    });
  } finally {
    if (hadLight) html.classList.add("light");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = A4_WIDTH_MM - MARGIN_MM * 2;
  const pageHeight = A4_HEIGHT_MM - MARGIN_MM * 2;
  const ratio = canvas.width / canvas.height;
  const imgWidth = pageWidth;
  const imgHeight = imgWidth / ratio;

  if (imgHeight <= pageHeight) {
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(
      imgData,
      "JPEG",
      MARGIN_MM,
      MARGIN_MM,
      imgWidth,
      imgHeight,
      undefined,
      "FAST",
    );
  } else {
    // Slice the canvas vertically into A4-page-height chunks.
    const sliceHeightPx = (canvas.width * pageHeight) / imgWidth;
    let yOffset = 0;
    let firstPage = true;

    while (yOffset < canvas.height) {
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.min(sliceHeightPx, canvas.height - yOffset);
      const ctx = sliceCanvas.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        yOffset,
        canvas.width,
        sliceCanvas.height,
        0,
        0,
        canvas.width,
        sliceCanvas.height,
      );

      const sliceImg = sliceCanvas.toDataURL("image/jpeg", 0.92);
      const sliceMm = (sliceCanvas.height * imgWidth) / canvas.width;

      if (!firstPage) pdf.addPage();
      firstPage = false;

      pdf.addImage(
        sliceImg,
        "JPEG",
        MARGIN_MM,
        MARGIN_MM,
        imgWidth,
        sliceMm,
        undefined,
        "FAST",
      );
      yOffset += sliceHeightPx;
    }
  }

  pdf.save(`${filename}.pdf`);
}

/**
 * Safer filename builder.
 */
export function pdfFilename(...parts) {
  return parts
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9\-_]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
