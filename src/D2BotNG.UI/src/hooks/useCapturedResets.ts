/**
 * Mutations on a v2 capture: clearing its accumulated kill counts or time-in-area, and forgetting
 * it altogether.
 *
 * The v1 pair (`useResetKills` / `useResetAreaTime`) does the same through CharacterService and
 * needs no invalidation, because the backend re-broadcasts the cleared character on the event
 * stream. Captures are pulled rather than streamed, so nothing arrives on its own — these
 * invalidate the character query instead, which is the whole reason they are separate hooks and
 * not a `schema` argument to the v1 ones.
 *
 * Every one takes the capture's `CharacterKey`, as the endpoints do.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CharacterKey } from "@/generated/captures_pb";
import { captureClient } from "@/lib/grpc-client";
import { toast } from "@/stores/toast-store";
import { captureKeys } from "./useCaptures";

function useCapturedReset(
  action: (key: CharacterKey) => Promise<unknown>,
  successMessage: string,
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: CharacterKey) => {
      await action(key);
      return key;
    },
    onSuccess: async (key) => {
      await queryClient.invalidateQueries({
        queryKey: captureKeys.character(key),
      });
      toast.success(successMessage);
    },
    onError: (error) => {
      toast.error(errorMessage, error.message);
    },
  });
}

export function useResetCapturedKills() {
  return useCapturedReset(
    (key) => captureClient.resetKills(key),
    "Kills reset",
    "Failed to reset kills",
  );
}

export function useResetCapturedAreaTime() {
  return useCapturedReset(
    (key) => captureClient.resetAreaTime(key),
    "Area stats reset",
    "Failed to reset area stats",
  );
}

/**
 * Drops the capture. The list follows on its own — the server re-broadcasts the summaries — so
 * the only local work is dropping the cached character, which nothing will ask for again.
 */
export function useForgetCapturedCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: CharacterKey) => {
      await captureClient.forgetCharacter(key);
      return key;
    },
    onSuccess: (key) => {
      queryClient.removeQueries({ queryKey: captureKeys.character(key) });
      toast.success("Character forgotten");
    },
    onError: (error) => {
      toast.error("Failed to forget character", error.message);
    },
  });
}
