import { useNavigate, useSearch } from "@tanstack/react-router";
import { buildSearch, readSearchString } from "./search.ts";

export function useProbe(): string | null {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const network = readSearchString(search, "network");
  navigate({
    to: "/operations/network",
    search: buildSearch({ network, block: "b1" }),
    replace: true,
  });
  navigate({
    to: "/operations/schedule",
    search: buildSearch({ network, plan: null }),
  });
  navigate({ to: "/operations" });
  return network;
}
