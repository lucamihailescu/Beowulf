import type { SchemaActionMetadata, SchemaMetadata, SchemaNamespaceMetadata } from "./api";

export type ActionRefOption = {
  namespace: string;
  actionType: string;
  actionId: string;
  principalTypes: string[];
  resourceTypes: string[];
  contextAttributes: string[];
};

export type NormalizedSchemaOptions = {
  namespaces: string[];
  entityTypes: string[];
  actionIds: string[];
  actionRefs: ActionRefOption[];
  contextAttributes: string[];
};

type UnknownMap = Record<string, unknown>;

function asRecord(v: unknown): UnknownMap {
  return v && typeof v === "object" ? (v as UnknownMap) : {};
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string");
}

function mapKeys(v: unknown): string[] {
  return Object.keys(asRecord(v)).sort();
}

function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function qualifyType(namespace: string, typeName: string): string {
  if (!namespace || typeName.includes("::")) return typeName;
  return `${namespace}::${typeName}`;
}

type NamespaceEntry = {
  name: string;
  schema: UnknownMap;
};

function collectNamespaceEntries(root: UnknownMap): NamespaceEntry[] {
  const hasDirectSchema = "entityTypes" in root || "actions" in root;
  if (hasDirectSchema) return [{ name: "", schema: root }];

  const entries: NamespaceEntry[] = [];
  for (const [key, value] of Object.entries(root)) {
    const ns = asRecord(value);
    if ("entityTypes" in ns || "actions" in ns) {
      entries.push({ name: key, schema: ns });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSchemaMetadataFromText(schemaText: string): SchemaMetadata | null {
  try {
    const parsed = JSON.parse(schemaText) as UnknownMap;
    const namespaces = collectNamespaceEntries(parsed);
    if (namespaces.length === 0) return null;

    const namespaceItems: SchemaNamespaceMetadata[] = [];
    const actionItems: SchemaActionMetadata[] = [];
    const allEntityTypes: string[] = [];
    const allActionIDs: string[] = [];
    const allContextAttributes: string[] = [];

    for (const namespaceEntry of namespaces) {
      const ns = namespaceEntry.name;
      const schema = namespaceEntry.schema;
      const entityTypeNames = mapKeys(schema.entityTypes);
      const qualifiedEntityTypes = entityTypeNames.map((t) => qualifyType(ns, t));

      const actionMap = asRecord(schema.actions);
      const actionNames = Object.keys(actionMap).sort();

      namespaceItems.push({
        name: ns,
        entity_types: qualifiedEntityTypes,
        actions: actionNames,
      });

      allEntityTypes.push(...qualifiedEntityTypes);
      allActionIDs.push(...actionNames);

      for (const actionName of actionNames) {
        const actionDef = asRecord(actionMap[actionName]);
        const appliesTo = asRecord(actionDef.appliesTo);
        const principalTypes = toStringArray(appliesTo.principalTypes).map((t) => qualifyType(ns, t));
        const resourceTypes = toStringArray(appliesTo.resourceTypes).map((t) => qualifyType(ns, t));
        const contextAttributes = mapKeys(asRecord(asRecord(appliesTo.context).attributes));

        actionItems.push({
          namespace: ns,
          name: actionName,
          action_type: qualifyType(ns, "Action"),
          principal_types: dedupeSorted(principalTypes),
          resource_types: dedupeSorted(resourceTypes),
          context_attributes: contextAttributes,
        });
        allContextAttributes.push(...contextAttributes);
      }
    }

    return {
      namespaces: namespaceItems,
      entity_types: dedupeSorted(allEntityTypes),
      actions: actionItems.sort((a, b) => `${a.namespace}:${a.name}`.localeCompare(`${b.namespace}:${b.name}`)),
      action_ids: dedupeSorted(allActionIDs),
      context_attributes: dedupeSorted(allContextAttributes),
    };
  } catch {
    return null;
  }
}

export function normalizeSchemaMetadata(metadata: SchemaMetadata | null | undefined): NormalizedSchemaOptions {
  if (!metadata) {
    return {
      namespaces: [],
      entityTypes: [],
      actionIds: [],
      actionRefs: [],
      contextAttributes: [],
    };
  }

  const actionRefs: ActionRefOption[] = metadata.actions.map((a) => ({
    namespace: a.namespace,
    actionType: a.action_type,
    actionId: a.name,
    principalTypes: a.principal_types ?? [],
    resourceTypes: a.resource_types ?? [],
    contextAttributes: a.context_attributes ?? [],
  }));

  return {
    namespaces: dedupeSorted(metadata.namespaces.map((n) => n.name)),
    entityTypes: dedupeSorted(metadata.entity_types),
    actionIds: dedupeSorted(metadata.action_ids),
    actionRefs: actionRefs.sort((a, b) => `${a.namespace}:${a.actionId}`.localeCompare(`${b.namespace}:${b.actionId}`)),
    contextAttributes: dedupeSorted(metadata.context_attributes),
  };
}
