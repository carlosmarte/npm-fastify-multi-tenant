import React from "react";
import { Routes, Route } from "react-router-dom";

const GettingStarted = () => "hello from getting started";

const GettingStartedComponents = () => {
  return (
    <Routes>
      <Route path="" element={<GettingStarted />} />
    </Routes>
  );
};

export default GettingStartedComponents;
