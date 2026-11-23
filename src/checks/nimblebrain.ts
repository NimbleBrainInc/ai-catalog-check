// The nimblebrain profile's checks (`profiles/nimblebrain.yaml`), keyed by ID.

import { pointer } from "../json.ts";
import type { DocumentCheck, Outcome, Violation } from "./types.ts";
import { entries, isObject, MEDIA_TYPES, urnAir } from "./walk.ts";

/** The kind each artifact type's identifier ends in. */
export const KIND_BY_TYPE: Record<string, string> = {
  [MEDIA_TYPES.mcpServerCard]: "mcp",
  [MEDIA_TYPES.agentPluginsZip]: "plugin",
  [MEDIA_TYPES.agentPluginsGzip]: "plugin",
  [MEDIA_TYPES.agentSkillsZip]: "skill",
  [MEDIA_TYPES.agentSkillsGzip]: "skill",
  [MEDIA_TYPES.agentSkillsJson]: "skill",
  [MEDIA_TYPES.agentSkillsMd]: "skill",
  [MEDIA_TYPES.a2aAgentCard]: "a2a",
  [MEDIA_TYPES.aiCatalog]: "catalog",
};

function overUrns(
  catalog: Parameters<DocumentCheck>[0]["catalog"],
  each: (e: ReturnType<typeof entries>[number], urn: NonNullable<ReturnType<typeof urnAir>>) => Violation[],
): Outcome {
  const list = entries(catalog).flatMap((e) => {
    const urn = typeof e.value.identifier === "string" ? urnAir(e.value.identifier) : undefined;
    return urn ? [{ e, urn }] : [];
  });
  if (list.length === 0) return "n/a";
  return list.flatMap(({ e, urn }) => each(e, urn));
}

export const nimblebrainChecks: Record<string, DocumentCheck> = {
  "NB-1": ({ catalog }) => {
    const list = entries(catalog).filter((e) => typeof e.value.identifier === "string");
    if (list.length === 0) return "n/a";
    return list.flatMap((e) => {
      const urn = urnAir(e.value.identifier as string);
      return urn?.kind
        ? []
        : [{ at: pointer(e.at, "identifier"), message: `"${e.value.identifier}" is not urn:air:{publisher}:{name}:{kind}` }];
    });
  },

  "NB-2": ({ catalog }) =>
    overUrns(catalog, (e, urn) => {
      const kind = typeof e.value.type === "string" ? KIND_BY_TYPE[e.value.type] : undefined;
      if (!kind || !urn.kind || urn.kind === kind) return []; // NB-1 reports a missing kind
      // The usual slip puts the kind first: urn:air:example.com:mcp:weather.
      const swapped = urn.name === kind && urn.kind ? `, as in urn:air:${urn.publisher}:${urn.kind}:${kind}` : "";
      return [
        {
          at: pointer(e.at, "identifier"),
          message: `"${e.value.identifier}" should end in ":${kind}" for ${e.value.type}${swapped}`,
        },
      ];
    }),

  "NB-3": ({ catalog }) =>
    overUrns(catalog, (e, urn) => {
      const publisher = e.value.publisher;
      if (!isObject(publisher) || typeof publisher.identifier !== "string") return [];
      // The domain, or the same domain as a root did:web DID, as the spec's examples write it.
      return publisher.identifier === urn.publisher || publisher.identifier === `did:web:${urn.publisher}`
        ? []
        : [
            {
              at: pointer(pointer(e.at, "publisher"), "identifier"),
              message: `\`publisher.identifier\` "${publisher.identifier}" is not "${urn.publisher}" (or did:web:${urn.publisher}), the identifier's {publisher}`,
            },
          ];
    }),
};
