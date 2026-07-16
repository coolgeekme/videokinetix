export function mapSwimmingCropLandmark(
  landmark,
  crop,
  rotation = "none"
) {
  let sourceX = landmark.x;
  let sourceY = landmark.y;

  if (rotation === "clockwise") {
    sourceX = landmark.y;
    sourceY = 1 - landmark.x;
  } else if (rotation === "counterclockwise") {
    sourceX = 1 - landmark.y;
    sourceY = landmark.x;
  }

  return {
    ...landmark,
    x: crop.x + sourceX * crop.width,
    y: crop.y + sourceY * crop.height,
  };
}

export function mapSwimmingCropPoses(poses, crop, rotation = "none") {
  return (poses || []).map((pose) =>
    pose.map((landmark) =>
      mapSwimmingCropLandmark(landmark, crop, rotation)
    )
  );
}
