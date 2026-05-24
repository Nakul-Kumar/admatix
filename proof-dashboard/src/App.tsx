import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Overview } from "./views/Overview";
import { Worlds } from "./views/Worlds";
import { Benchmark } from "./views/Benchmark";
import { Validation } from "./views/Validation";
import { Decisions } from "./views/Decisions";
import { Artifacts } from "./views/Artifacts";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="worlds" element={<Worlds />} />
        <Route path="benchmark" element={<Benchmark />} />
        <Route path="validation" element={<Validation />} />
        <Route path="decisions" element={<Decisions />} />
        <Route path="artifacts" element={<Artifacts />} />
      </Route>
    </Routes>
  );
}
