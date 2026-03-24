import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { DashboardOverview } from './pages/DashboardOverview/index.tsx';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardOverview />} />
      </Routes>
    </BrowserRouter>
  );
}
