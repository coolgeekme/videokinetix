import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <span className="font-display uppercase tracking-widest text-sm text-zinc-500">
          Loading…
        </span>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
