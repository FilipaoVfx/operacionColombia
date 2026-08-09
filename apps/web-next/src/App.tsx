import { lazy, Suspense } from "react";
import { Link, Route, Router, Switch, useRoute } from "wouter";
import { useMeta } from "./api/cliente";
import { PaginaInicio } from "./pages/Inicio";
import { PaginaEntidades } from "./pages/Entidades";
import { PaginaEntidad } from "./pages/Entidad";
import { PaginaRegistro } from "./pages/Registro";
import { Cargando, FechaRelativa, Numero } from "./components/base";

// Las rutas de análisis cargan Chart.js aparte: la portada y las fichas no
// pagan esos bytes. Es la razón por la que el bundle base se mantiene chico.
const PaginaContratacion = lazy(() =>
  import("./pages/Contratacion").then((m) => ({ default: m.PaginaContratacion })));

/**
 * Shell. La navegación lista solo lo que existe y tiene dato detrás: el mockup
 * incluía Insights, Riesgos, Oportunidades, Watchlist, Workspace, Escenarios y
 * Reportes, todos sin respaldo (ni motor de detección, ni histórico, ni sesión
 * de usuario). Se incorporan cuando exista el dato que los sostenga.
 */
// En producción el panel vive bajo /next; con el dev server de Vite, en la raíz.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <Router base={BASE}>
      <Contenido />
    </Router>
  );
}

function Contenido() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Switch>
          <Route path="/" component={PaginaInicio} />
          <Route path="/entidades" component={PaginaEntidades} />
          <Route path="/entidades/:id">{(p) => <PaginaEntidad id={decodeURIComponent(p.id)} />}</Route>
          <Route path="/registros/:id">{(p) => <PaginaRegistro id={decodeURIComponent(p.id)} />}</Route>
          <Route path="/contratacion">
            <Suspense fallback={<Cargando filas={8} />}><PaginaContratacion /></Suspense>
          </Route>
          <Route>
            <div className="p-8 text-center text-sm text-ink-muted">Página no encontrada.</div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}

function Sidebar() {
  const { data, error } = useMeta();
  const registros = data?.dominios.reduce((a, d) => a + d.n, 0) ?? null;

  return (
    <nav className="flex w-60 shrink-0 flex-col bg-sidebar text-ink-invert">
      <div className="px-4 py-4">
        <p className="text-base font-semibold leading-tight">Operación Colombia</p>
        <p className="text-2xs text-ink-invert-muted">Inteligencia territorial</p>
      </div>

      <p className="px-4 pb-1 pt-3 text-2xs uppercase tracking-wider text-ink-invert-muted">Explorar</p>
      <Item href="/" match="/">Inicio</Item>
      <Item href="/entidades" match="/entidades">Entidades</Item>
      <Item href="/contratacion" match="/contratacion">Contratación</Item>

      <div className="mt-auto space-y-2 border-t border-white/10 px-4 py-3 text-2xs">
        {error ? (
          <p className="text-error">API no disponible</p>
        ) : data ? (
          <>
            <p className="flex items-center gap-1.5 text-ink-invert-muted">
              <span aria-hidden className="size-1.5 rounded-full bg-ok" />
              versión de datos {data.version_datos}
            </p>
            <p className="text-ink-invert-muted">
              <Numero valor={registros} /> registros · {data.fuentes.length} fuentes
            </p>
            {data.ultima_corrida[0] && (
              <p className="text-ink-invert-muted">
                última ingesta <FechaRelativa iso={data.ultima_corrida[0].finished_at} />
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-invert-muted">conectando…</p>
        )}
      </div>
    </nav>
  );
}

function Item({ href, match, children }: { href: string; match: string; children: React.ReactNode }) {
  const [activo] = useRoute(match);
  return (
    <Link
      href={href}
      className={`mx-2 rounded-md px-2.5 py-1.5 text-sm ${
        activo ? "bg-sidebar-active text-white" : "text-ink-invert-muted hover:bg-sidebar-hover hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}
