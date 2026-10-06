import { LogoLoading } from "@/components/route-loading";
import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultErrorComponent: AppErrorComponent,
    defaultPendingComponent: LogoLoading,
    defaultPendingMs: 180,
    defaultPendingMinMs: 200,
  });
}
