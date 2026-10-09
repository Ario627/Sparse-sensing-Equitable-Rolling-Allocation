import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { NotFoundView, RootError, RootLayout } from "@/app/root-route.tsx";
import { Skeleton } from "@/components/kit/skeleton.tsx";
import { AppShellLayout } from "@/components/shell/app-shell.tsx";
import { requireSession } from "@/lib/auth/guard.ts";
import { LandingPage } from "@/routes/landing";
import { LoginPage } from "@/routes/login.tsx";
import { AlertsPage } from "@/routes/operations/alerts.tsx";
import { HistoryPage } from "@/routes/operations/history.tsx";
import { NetworkPage } from "@/routes/operations/network.tsx";
import { OverviewPage } from "@/routes/operations/overview.tsx";
import { SchedulePage } from "@/routes/operations/schedule.tsx";
import { HardwarePage } from "@/routes/system/hardware.tsx";
import { SettingsPage } from "@/routes/system/settings.tsx";

const PENDING_DELAY_MS = 150;
const PENDING_MIN_MS = 300;

const SimulationPage = lazyRouteComponent(
  () => import("@/routes/lab/simulation.tsx"),
  "SimulationPage",
);

const ExperimentsPage = lazyRouteComponent(
  () => import("@/routes/lab/experiments.tsx"),
  "ExperimentsPage",
);

const SensorBudgetPage = lazyRouteComponent(
  () => import("@/routes/lab/sensor-budget.tsx"),
  "SensorBudgetPage",
);

const ResultsPage = lazyRouteComponent(
  () => import("@/routes/lab/results.tsx"),
  "ResultsPage",
);

function RoutePending() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-64" />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFoundView,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppShellLayout,
  beforeLoad: async ({ location }) => {
    await requireSession(location.href);
  },
});

const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations",
  component: OverviewPage,
});

const networkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations/network",
  component: NetworkPage,
});

const scheduleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations/schedule",
  component: SchedulePage,
});

const alertsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations/alerts",
  component: AlertsPage,
});

const historyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations/history",
  component: HistoryPage,
});

const simulationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lab/simulation",
  component: SimulationPage,
});

const experimentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lab/experiments",
  component: ExperimentsPage,
});

const sensorBudgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lab/sensor-budget",
  component: SensorBudgetPage,
});

const resultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lab/results",
  component: ResultsPage,
});

const hardwareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/system/hardware",
  component: HardwarePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/system/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  appRoute.addChildren([
    operationsRoute,
    networkRoute,
    scheduleRoute,
    alertsRoute,
    historyRoute,
    simulationRoute,
    experimentsRoute,
    sensorBudgetRoute,
    resultsRoute,
    hardwareRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: RoutePending,
  defaultPendingMs: PENDING_DELAY_MS,
  defaultPendingMinMs: PENDING_MIN_MS,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
