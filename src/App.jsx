import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Sidebar from "./components/layout/Sidebar";
import LoginPage from "./pages/LoginPage";
import EVMPage from "./pages/EVMPage";
import Dashboard from "./pages/DashboardPage";
import HouseholdsPage from "./pages/HouseholdsPage";
import ResultsPage from "./pages/ResultsPage";

// Remaining stubs — intentionally NOT a per-voter searchable registry;
// keep any future "Voter Data" screen limited to what electoral-roll law
// in your jurisdiction actually permits to display, and never pair it
// with national-ID or biometric fields.
const VotedPage    = () => <Page title="Turnout">✅ Aggregate turnout counts (see Households for detail)</Page>;
const BlockchainPg = () => <Page title="Blockchain Logs">⛓️ On-chain transaction log (eligibility/turnout only, ballots are anonymous)</Page>;
const FraudPage    = () => <Page title="Fraud Detection">🚨 Anomaly alerts (duplicate registration, impossible turnout, etc.)</Page>;
const ReportsPage  = () => <Page title="Reports">📄 Export aggregate reports</Page>;
const SettingsPage = () => <Page title="Settings">⚙️ Election and system configuration</Page>;

function Page({ title, children }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white mb-4">{title}</h1>
      <div className="bg-[#0b1529] border border-[#1e3050] rounded-xl p-6 text-slate-400 text-sm">{children}</div>
    </div>
  );
}

function ProtectedRoute({ children, page }) {
  const { user, loading, canAccess } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">Loading...</div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (page && !canAccess(page)) return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
      <span className="text-4xl mb-3">🔒</span>
      <p className="text-lg">Access Denied</p>
      <p className="text-sm">You don't have permission to view this page.</p>
    </div>
  );
  return children;
}

function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex min-h-screen bg-[#060d1f]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard"  element={<ProtectedRoute page="dashboard"><Dashboard/></ProtectedRoute>}/>
          <Route path="/evm"        element={<ProtectedRoute page="evm"><div className="p-6"><EVMPage/></div></ProtectedRoute>}/>
          <Route path="/voters"     element={<ProtectedRoute page="voters"><HouseholdsPage/></ProtectedRoute>}/>
          <Route path="/voted"      element={<ProtectedRoute page="voted"><VotedPage/></ProtectedRoute>}/>
          <Route path="/parties"    element={<ProtectedRoute page="parties"><ResultsPage/></ProtectedRoute>}/>
          <Route path="/blockchain" element={<ProtectedRoute page="blockchain"><BlockchainPg/></ProtectedRoute>}/>
          <Route path="/fraud"      element={<ProtectedRoute page="fraud"><FraudPage/></ProtectedRoute>}/>
          <Route path="/reports"    element={<ProtectedRoute page="reports"><ReportsPage/></ProtectedRoute>}/>
          <Route path="/settings"   element={<ProtectedRoute page="settings"><SettingsPage/></ProtectedRoute>}/>
          <Route path="*"           element={<Navigate to="/dashboard" replace/>}/>
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { background:"#0b1529", color:"#e2e8f0", border:"1px solid #1e3050" }}}/>
        <Routes>
          <Route path="/login" element={<LoginPage/>}/>
          <Route path="/*"     element={<AppLayout/>}/>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
