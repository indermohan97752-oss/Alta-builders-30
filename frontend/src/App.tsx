import { Navigate, Route, Routes } from "react-router-dom";
import { isAuthenticated } from "./api";
import { isCryptoUnlocked } from "./crypto";
import AdminPage from "./pages/AdminPage";
import AuthPage from "./pages/AuthPage";
import RoomsPage from "./pages/RoomsPage";
import ChatRoomPage from "./pages/ChatRoomPage";
import ProfilePage from "./pages/ProfilePage";
import InviteJoinPage from "./pages/InviteJoinPage";

function Protected({ children }: { children: JSX.Element }) {
  return isAuthenticated() && isCryptoUnlocked() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/invite/:token" element={<Protected><InviteJoinPage /></Protected>} />
      <Route path="/" element={<Protected><RoomsPage /></Protected>} />
      <Route path="/admin" element={<Protected><AdminPage /></Protected>} />
      <Route path="/rooms/:roomId" element={<Protected><ChatRoomPage /></Protected>} />
      <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
