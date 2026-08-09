import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./styles/tokens.css";

// Sin reintentos agresivos ni datos de reemplazo: si la API falla, la vista lo dice.
const cliente = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
