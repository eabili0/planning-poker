import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PlanningPoker from './components/PlanningPoker';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<PlanningPoker />} />
        <Route path="/rooms/:roomId" element={<PlanningPoker />} />
      </Routes>
    </Router>
  );
}

export default App;