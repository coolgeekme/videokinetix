import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Athletes from "@/pages/Athletes";
import AthleteDetail from "@/pages/AthleteDetail";
import Capture from "@/pages/Capture";
import Sessions from "@/pages/Sessions";
import SessionDetail from "@/pages/SessionDetail";
import TrainingPlans from "@/pages/TrainingPlans";
import Goals from "@/pages/Goals";

function App() {
  return (
    <div className="App min-h-screen bg-[#0a0a0a] text-white">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="athletes" element={<Athletes />} />
              <Route path="athletes/:id" element={<AthleteDetail />} />
              <Route path="capture" element={<Capture />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="sessions/:id" element={<SessionDetail />} />
              <Route path="training-plans" element={<TrainingPlans />} />
              <Route path="goals" element={<Goals />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#121212",
                border: "1px solid #27272a",
                color: "#fff",
                borderRadius: 0,
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
