import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import GettingStarted from "fastify-multitenant-getting-started/react/routes.jsx";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <div>
        <App />
        <GettingStarted />
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
