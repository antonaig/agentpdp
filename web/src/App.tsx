import { Routes, Route } from "react-router-dom";
import { GeneratorPage } from "./pages/Generator";
import { ProductPage } from "./pages/Product";
import { ComparePage } from "./pages/Compare";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<GeneratorPage />} />
      <Route path="/p/*" element={<ProductPage />} />
      <Route path="/compare" element={<ComparePage />} />
    </Routes>
  );
}
