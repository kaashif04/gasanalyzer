import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import AppShell from "./components/layout/AppShell";
import { LiveDataProvider } from "./context/LiveDataContext";
import { UnitProvider } from "./context/UnitContext";
import LiveDashboard from "./pages/LiveDashboard";
import Trends from "./pages/Trends";
import Diagnostics from "./pages/Diagnostics";
import ExportPage from "./pages/Export";
import Calibrated from "./pages/Calibrated";

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <Routes location={location}>
          <Route path="/" element={<LiveDashboard />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/calibrated" element={<Calibrated />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <UnitProvider>
      <LiveDataProvider>
        <AppShell>
          <AnimatedRoutes />
        </AppShell>
      </LiveDataProvider>
    </UnitProvider>
  );
}
