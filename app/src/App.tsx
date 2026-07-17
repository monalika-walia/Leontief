import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/TxToast";
import { useApp } from "./ctx";
import { Borrow } from "./routes/Borrow";
import { Demo } from "./routes/Demo";
import { Positions } from "./routes/Positions";
import { VaultDetail } from "./routes/VaultDetail";
import { Vaults } from "./routes/Vaults";

export function App() {
  const { env } = useApp();
  const demoEnabled = env.DEMO && env.NETWORK_PASSPHRASE.includes("Test SDF Network");
  return (
    <ToastProvider>
      <Shell demoEnabled={demoEnabled}>
        <Routes>
          <Route path="/" element={<Navigate to="/vaults" replace />} />
          <Route path="/vaults" element={<Vaults />} />
          <Route path="/vaults/:id" element={<VaultDetail />} />
          <Route path="/borrow" element={<Borrow />} />
          <Route path="/positions" element={<Positions />} />
          {demoEnabled && <Route path="/demo" element={<Demo />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </ToastProvider>
  );
}

function NotFound() {
  return (
    <div className="wrap" style={{ padding: "80px 24px" }}>
      <div className="fig">Not found</div>
      <p className="dim">
        <NavLink to="/vaults">← back to markets</NavLink>
      </p>
    </div>
  );
}
