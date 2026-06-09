// Standalone entry: bundles the gacha UI (web/app/gacha/page.tsx) into a
// self-contained static build served by the matchmaker crank at /.
// page.tsx fetches /api/gacha/stats; the crank aliases that to /stats, so the
// exact same component works both inside Next and served from the crank.
import { createRoot } from "react-dom/client";
import GachaPage from "@/app/gacha/page";
import "@/app/gacha/gacha.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<GachaPage />);
