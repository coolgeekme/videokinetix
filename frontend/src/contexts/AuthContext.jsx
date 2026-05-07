import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kinetic_user") || "null");
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("kinetic_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("kinetic_user", JSON.stringify(r.data));
      })
      .catch(() => {
        localStorage.removeItem("kinetic_token");
        localStorage.removeItem("kinetic_user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("kinetic_token", data.access_token);
    localStorage.setItem("kinetic_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post("/auth/register", { name, email, password });
    localStorage.setItem("kinetic_token", data.access_token);
    localStorage.setItem("kinetic_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("kinetic_token");
    localStorage.removeItem("kinetic_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
