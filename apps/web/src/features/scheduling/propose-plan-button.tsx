import { Button } from "@/components/kit/button.tsx";
import { isApiError } from "@/lib/api/client.ts";
import { useProposePlan } from "./api.ts";

const DEFAULT_LABEL = "Ajukan plan";

export interface ProposePlanButtonProps {
  readonly networkId: string;
  readonly label?: string;
}

export function ProposePlanButton({
  networkId,
  label = DEFAULT_LABEL,
}: ProposePlanButtonProps) {
  const propose = useProposePlan();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="sm"
        variant="primary"
        pending={propose.isPending}
        pendingLabel="Menyusun…"
        onClick={() => {
          propose.mutate({ network_id: networkId, profile: "BALANCED" });
        }}
      >
        {label}
      </Button>
      {propose.isError && (
        <p role="alert" className="text-xs text-crit">
          {isApiError(propose.error)
            ? propose.error.message
            : "Pengajuan plan gagal. Coba lagi."}
        </p>
      )}
    </div>
  );
}
