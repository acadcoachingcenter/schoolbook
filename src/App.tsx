import { Home } from "./pages/Home";
import { Admin } from "./pages/Admin";

export default function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  return isAdmin ? <Admin /> : <Home />;
}
