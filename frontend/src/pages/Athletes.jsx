import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, User, ArrowRight, X } from "lucide-react";

const SPORTS = ["basketball", "soccer", "swimming", "pickleball"];

export default function Athletes() {
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // athlete object or null
  const [form, setForm] = useState({ name: "", age: "", primary_sport: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);

  const refresh = () =>
    api.get("/athletes").then((r) => setAthletes(r.data.athletes));

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", age: "", primary_sport: "", notes: "" });
    setShowForm(true);
  };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      name: a.name || "",
      age: a.age ?? "",
      primary_sport: a.primary_sport || "",
      notes: a.notes || "",
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      age: form.age === "" ? null : parseInt(form.age),
      primary_sport: form.primary_sport || null,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        await api.patch(`/athletes/${editing.id}`, payload);
        toast.success("Athlete updated");
      } else {
        await api.post("/athletes", payload);
        toast.success("Athlete added");
      }
      setShowForm(false);
      await refresh();
    } catch (err) {
      toast.error(errMsg(err, "Failed to save athlete"));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (a) => {
    if (a.is_self) {
      toast.error("Cannot delete your 'Me' profile");
      return;
    }
    if (!window.confirm(`Delete ${a.name} and all their sessions, plans & goals?`)) return;
    try {
      await api.delete(`/athletes/${a.id}`);
      setAthletes((arr) => arr.filter((x) => x.id !== a.id));
      toast.success("Athlete deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Roster
          </div>
          <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
            Athletes
          </h1>
          <p className="mt-2 text-sm text-zinc-400 max-w-xl">
            Track multiple athletes. Each athlete keeps their own sessions, plans, goals and progress per sport.
          </p>
        </div>
        <button
          data-testid="new-athlete-btn"
          onClick={openCreate}
          className="self-start sm:self-auto inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-5 py-2.5 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add athlete
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          data-testid="athlete-form"
          className="bg-[#121212] border border-white/10 p-5 space-y-4 relative"
        >
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="absolute top-3 right-3 text-zinc-500 hover:text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-400 mb-1">
              {editing ? "Edit" : "New"}
            </div>
            <h3 className="font-display font-black uppercase tracking-tight text-2xl">
              {editing ? `Edit ${editing.name}` : "Add athlete"}
            </h3>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Name
              </label>
              <input
                data-testid="athlete-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={80}
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Age
              </label>
              <input
                data-testid="athlete-age"
                type="number"
                min={4}
                max={120}
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
                placeholder="—"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Primary sport
              </label>
              <select
                data-testid="athlete-sport"
                value={form.primary_sport}
                onChange={(e) => setForm({ ...form, primary_sport: e.target.value })}
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] capitalize"
              >
                <option value="">Not set</option>
                {SPORTS.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
              Notes
            </label>
            <textarea
              data-testid="athlete-notes"
              rows={3}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] resize-none"
              placeholder="Goals, injuries, position, dominant hand..."
            />
          </div>
          <div className="flex gap-3">
            <button
              data-testid="athlete-submit"
              type="submit"
              disabled={submitting}
              className="bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-50 text-white font-display uppercase tracking-wide px-5 py-2"
            >
              {submitting ? "Saving…" : editing ? "Save changes" : "Create athlete"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-white/10 hover:bg-white/5 px-5 py-2 font-display uppercase tracking-wide"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : athletes.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-12 text-center">
          <User className="w-10 h-10 text-zinc-700 mx-auto" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-zinc-400">No athletes yet — add your first.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {athletes.map((a) => (
            <div
              key={a.id}
              data-testid={`athlete-card-${a.id}`}
              className="border border-white/10 bg-[#121212] p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 flex items-center justify-center font-display font-black ${
                      a.is_self ? "bg-[#ff3b30] text-white" : "bg-white/5 text-white border border-white/10"
                    }`}
                  >
                    {a.name?.[0]?.toUpperCase() || "A"}
                  </div>
                  <div>
                    <div className="font-display uppercase tracking-tight font-bold text-lg leading-none">
                      {a.name}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold mt-1">
                      {a.is_self ? "You" : a.primary_sport ? a.primary_sport : "Athlete"}
                      {a.age ? ` · ${a.age}y` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid={`edit-athlete-${a.id}`}
                    onClick={() => openEdit(a)}
                    className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {!a.is_self && (
                    <button
                      data-testid={`delete-athlete-${a.id}`}
                      onClick={() => remove(a)}
                      className="p-2 text-zinc-400 hover:text-[#ff3b30] hover:bg-white/5 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4">
                <Stat label="Sessions" value={a.stats?.sessions ?? 0} />
                <Stat label="Avg" value={a.stats?.avg_score ?? 0} accent />
                <Stat label="Best" value={a.stats?.best_score ?? 0} />
              </div>

              <Link
                to={`/app/athletes/${a.id}`}
                data-testid={`open-athlete-${a.id}`}
                className="mt-auto inline-flex items-center justify-between gap-2 border border-white/10 hover:border-[#ff3b30] hover:text-[#ff3b30] px-3 py-2 text-sm font-display uppercase tracking-wide transition-colors"
              >
                Open profile <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500">
        {label}
      </div>
      <div
        className={`font-display font-black text-2xl ${accent ? "text-[#00ff88]" : "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}
