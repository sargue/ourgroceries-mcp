export interface Timestamp {
  epochMs: number;
  iso: string;
}

export interface ListSummary {
  id: string;
  name: string;
  itemCount: number;
  activeItemCount: number;
  crossedOffItemCount: number;
  versionId?: unknown;
}

export interface CategorySummary {
  id: string;
  name?: string;
  value?: string;
}

export interface SettingsSummary {
  settings: unknown;
  listSchemaVersion?: unknown;
}

export interface ItemSummary {
  id: string;
  value: string;
  name: string;
  barcode?: string;
  photoId?: string;
}

export interface CrossedOffItemSummary extends ItemSummary {
  crossedOffAt: Timestamp;
}

export interface CrossedOffItemsQuery {
  crossedOffAfter?: number | string;
  crossedOffBefore?: number | string;
  limit?: number;
  listId: string;
  offset?: number;
  search?: string;
  sortBy?: CrossedOffItemsSortBy;
  sortOrder?: SortOrder;
}

export interface CrossedOffItemsResult {
  listId: string;
  items: CrossedOffItemSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type CrossedOffItemsSortBy = "crossedOffAt" | "name";
export type SortOrder = "asc" | "desc";

export interface ResolveItemToAddQuery {
  limit?: number;
  listId?: string;
  query: string;
}

export interface ResolveItemToAddResult {
  query: string;
  listId?: string;
  candidates: ResolvedItemCandidate[];
}

export interface ResolvedItemCandidate {
  value: string;
  score: number;
  confidence: "high" | "medium" | "low";
  match: ItemMatch;
  addedCount: number;
  masterItemId?: string;
  masterLastAddedAt?: Timestamp;
  history: {
    shoppingOccurrenceCount: number;
    listCount: number;
    lastCrossedOffAt?: Timestamp;
  };
  targetList?: TargetListEvidence;
  recommendedAction: RecommendedAction;
}

export interface ItemMatch {
  type: ItemMatchType;
  matchedText: string;
  normalizedQuery: string;
  normalizedValue: string;
}

export type ItemMatchType = "exact" | "prefix" | "word" | "substring";

export type RecommendedAction =
  | { itemId: string; listId: string; type: "already_active" }
  | { itemId: string; listId: string; type: "uncross_item" }
  | { listId: string; type: "add_item"; value: string }
  | { type: "choose_list"; value: string };

export type TargetListEvidence =
  | { itemId: string; status: "active" }
  | { crossedOffAt: Timestamp; itemId: string; status: "crossed_off" }
  | { status: "not_found" };

interface RawList {
  id?: unknown;
  items?: unknown;
  listType?: unknown;
  name?: unknown;
  versionId?: unknown;
}

interface RawItem {
  addedCount?: unknown;
  barcode?: unknown;
  crossedOffAt?: unknown;
  id?: unknown;
  lastAddedAt?: unknown;
  name?: unknown;
  photoId?: unknown;
  value?: unknown;
}

interface CandidateIndexEntry {
  value: string;
  addedCount: number;
  masterItemId?: string;
  masterLastAddedAt?: Timestamp;
  shoppingOccurrences: ShoppingOccurrence[];
}

interface ShoppingOccurrence {
  crossedOffAt?: Timestamp;
  itemId: string;
  listId: string;
}

interface ScoringContext {
  listId?: string;
  newestCrossedOffAt?: number;
}

interface ScoredCandidate {
  candidate: ResolvedItemCandidate;
  matchRank: number;
}

const shoppingListType = "SHOPPING";
const masterListType = "MASTER";
const categoryListType = "CATEGORY";
const defaultCrossedOffLimit = 50;
const maxCrossedOffLimit = 200;
const defaultResolverLimit = 10;
const maxResolverLimit = 20;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const queryStopWords = new Set([
  "a",
  "add",
  "agrega",
  "agregar",
  "al",
  "anade",
  "anadir",
  "añade",
  "añadir",
  "buy",
  "compra",
  "comprar",
  "de",
  "del",
  "el",
  "la",
  "las",
  "list",
  "lista",
  "los",
  "mete",
  "meter",
  "need",
  "para",
  "please",
  "pon",
  "poner",
  "to",
  "un",
  "una",
]);

export function getListSummaries(payload: unknown): ListSummary[] {
  return getLists(payload)
    .filter(isShoppingList)
    .flatMap((list) => {
      const id = stringValue(list.id);
      if (!id) {
        return [];
      }

      const items = getListItems(list);
      const summary: ListSummary = {
        id,
        name: stringValue(list.name) ?? "",
        itemCount: items.length,
        activeItemCount: items.filter(isActiveItem).length,
        crossedOffItemCount: items.filter((item) => getCrossedOffAt(item) !== undefined).length,
      };

      if (list.versionId !== undefined) {
        summary.versionId = list.versionId;
      }

      return [summary];
    });
}

export function getCategories(payload: unknown): CategorySummary[] {
  const categoryList = getLists(payload).find((list) => list.listType === categoryListType);
  if (!categoryList) {
    return [];
  }

  return getListItems(categoryList).flatMap((item): CategorySummary[] => {
    const id = stringValue(item.id);
    if (!id) {
      return [];
    }

    const name = stringValue(item.name);
    const value = stringValue(item.value);
    if (!name && !value) {
      return [];
    }

    if (value && (!name || name === value)) {
      return [{ id, value }];
    }

    if (value && name) {
      return [{ id, name, value }];
    }

    return [{ id, name: name ?? "" }];
  });
}

export function getSettings(payload: unknown): SettingsSummary {
  const record = requireRecord(payload, "OurGroceries getLists response");
  const result: SettingsSummary = {
    settings: record.settings ?? null,
  };

  if (record.listSchemaVersion !== undefined) {
    result.listSchemaVersion = record.listSchemaVersion;
  }

  return result;
}

export function getActiveItems(payload: unknown, listId: string): ItemSummary[] {
  const list = findShoppingList(payload, listId);

  return getListItems(list).filter(isActiveItem).flatMap(toItemSummary);
}

export function getCrossedOffItems(
  payload: unknown,
  query: CrossedOffItemsQuery
): CrossedOffItemsResult {
  const list = findShoppingList(payload, query.listId);
  const limit = normalizeIntegerOption(query.limit, "limit", defaultCrossedOffLimit, {
    max: maxCrossedOffLimit,
  });
  const offset = normalizeIntegerOption(query.offset, "offset", 0);
  const crossedOffAfter = parseDateInput(query.crossedOffAfter, "crossedOffAfter");
  const crossedOffBefore = parseDateInput(query.crossedOffBefore, "crossedOffBefore");
  const sortBy = query.sortBy ?? "crossedOffAt";
  const sortOrder = query.sortOrder ?? "desc";

  if (sortBy !== "crossedOffAt" && sortBy !== "name") {
    throw new Error('sortBy must be "crossedOffAt" or "name"');
  }

  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new Error('sortOrder must be "asc" or "desc"');
  }

  const normalizedSearch = query.search?.trim() ? normalizeText(query.search) : null;
  let items = getListItems(list).flatMap(toCrossedOffItemSummary);

  if (normalizedSearch) {
    items = items.filter((item) => {
      const normalizedValue = normalizeText(item.value);
      const normalizedName = normalizeText(item.name);

      return (
        normalizedValue.includes(normalizedSearch) || normalizedName.includes(normalizedSearch)
      );
    });
  }

  if (crossedOffAfter) {
    items = items.filter((item) => item.crossedOffAt.epochMs >= crossedOffAfter.epochMs);
  }

  if (crossedOffBefore) {
    items = items.filter((item) => item.crossedOffAt.epochMs <= crossedOffBefore.epochMs);
  }

  items.sort((left, right) => {
    const direction = sortOrder === "asc" ? 1 : -1;

    if (sortBy === "name") {
      return direction * compareStrings(left.name || left.value, right.name || right.value);
    }

    return direction * (left.crossedOffAt.epochMs - right.crossedOffAt.epochMs);
  });

  const total = items.length;
  const pagedItems = items.slice(offset, offset + limit);

  return {
    listId: query.listId,
    items: pagedItems,
    total,
    limit,
    offset,
    hasMore: offset + pagedItems.length < total,
  };
}

export function resolveItemToAdd(
  payload: unknown,
  query: ResolveItemToAddQuery
): ResolveItemToAddResult {
  const itemQuery = requireNonEmptyString(query.query, "query");
  const limit = normalizeIntegerOption(query.limit, "limit", defaultResolverLimit, {
    max: maxResolverLimit,
  });
  const listId = query.listId;

  if (listId !== undefined) {
    findShoppingList(payload, listId);
  }

  const entries = buildCandidateIndex(payload);
  const normalizedQuery = normalizeText(itemQuery);
  const queryTokens = significantQueryTokens(normalizedQuery);
  const newestCrossedOffAt = getNewestCrossedOffAt(entries);
  const scoringContext: ScoringContext = {
    listId,
    newestCrossedOffAt,
  };
  const candidates: ScoredCandidate[] = [];

  for (const entry of entries.values()) {
    const match = classifyMatch(entry.value, normalizedQuery, queryTokens);
    if (!match) {
      continue;
    }

    const candidate = toResolvedCandidate(entry, match, scoringContext);
    candidates.push({
      candidate,
      matchRank: matchRank(match.type),
    });
  }

  candidates.sort((left, right) => {
    const scoreComparison = right.candidate.score - left.candidate.score;
    if (scoreComparison !== 0) {
      return scoreComparison;
    }

    const matchComparison = right.matchRank - left.matchRank;
    if (matchComparison !== 0) {
      return matchComparison;
    }

    return compareStrings(left.candidate.value, right.candidate.value);
  });

  const result: ResolveItemToAddResult = {
    query: itemQuery,
    candidates: candidates.slice(0, limit).map((candidate) => candidate.candidate),
  };

  if (listId !== undefined) {
    result.listId = listId;
  }

  return result;
}

export function parseDateInput(
  value: number | string | undefined,
  fieldName: string
): Timestamp | undefined {
  if (value === undefined) {
    return undefined;
  }

  let epochMs: number;

  if (typeof value === "number") {
    epochMs = value;
  } else {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      throw new Error(`${fieldName} must be a valid date or epoch milliseconds`);
    }

    epochMs = /^-?\d+$/.test(trimmedValue) ? Number(trimmedValue) : Date.parse(trimmedValue);
  }

  return timestampFromEpoch(epochMs, fieldName);
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getLists(payload: unknown): RawList[] {
  const record = requireRecord(payload, "OurGroceries getLists response");
  if (!Array.isArray(record.lists)) {
    throw new Error("OurGroceries getLists response did not contain a lists array");
  }

  return record.lists.filter(isRecord);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShoppingList(list: RawList): boolean {
  return list.listType === shoppingListType;
}

function getListItems(list: RawList): RawItem[] {
  if (!Array.isArray(list.items)) {
    return [];
  }

  return list.items.filter(isRecord);
}

function findShoppingList(payload: unknown, listId: string): RawList {
  const list = getLists(payload).find(
    (candidate) => candidate.id === listId && isShoppingList(candidate)
  );
  if (!list) {
    throw new Error(`Unknown shopping list ID: ${listId}`);
  }

  return list;
}

function isActiveItem(item: RawItem): boolean {
  return !Object.prototype.hasOwnProperty.call(item, "crossedOffAt");
}

function toItemSummary(item: RawItem): ItemSummary[] {
  const id = stringValue(item.id);
  if (!id) {
    return [];
  }

  const value = itemValue(item);
  const name = itemName(item, value);
  const summary: ItemSummary = {
    id,
    value,
    name,
  };
  const barcode = stringValue(item.barcode);
  const photoId = stringValue(item.photoId);

  if (barcode) {
    summary.barcode = barcode;
  }

  if (photoId) {
    summary.photoId = photoId;
  }

  return [summary];
}

function toCrossedOffItemSummary(item: RawItem): CrossedOffItemSummary[] {
  const crossedOffAt = getCrossedOffAt(item);
  if (!crossedOffAt) {
    return [];
  }

  const summary = toItemSummary(item)[0];
  if (!summary) {
    return [];
  }

  return [
    {
      ...summary,
      crossedOffAt,
    },
  ];
}

function itemValue(item: RawItem): string {
  return stringValue(item.value) ?? stringValue(item.name) ?? "";
}

function itemName(item: RawItem, fallbackValue = ""): string {
  return stringValue(item.name) ?? fallbackValue;
}

function getCrossedOffAt(item: RawItem): Timestamp | undefined {
  if (!Object.prototype.hasOwnProperty.call(item, "crossedOffAt")) {
    return undefined;
  }

  return timestampFromUnknown(item.crossedOffAt);
}

function timestampFromUnknown(value: unknown): Timestamp | undefined {
  if (typeof value !== "number") {
    return undefined;
  }

  return timestampFromEpoch(value);
}

function timestampFromEpoch(epochMs: number, fieldName = "timestamp"): Timestamp {
  if (!Number.isFinite(epochMs)) {
    throw new Error(`${fieldName} must be a valid date or epoch milliseconds`);
  }

  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date or epoch milliseconds`);
  }

  return {
    epochMs,
    iso: date.toISOString(),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeIntegerOption(
  value: number | undefined,
  fieldName: string,
  defaultValue: number,
  options: { max?: number } = {}
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  if (value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return options.max === undefined ? value : Math.min(value, options.max);
}

function requireNonEmptyString(value: string, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
  });
}

function buildCandidateIndex(payload: unknown): Map<string, CandidateIndexEntry> {
  const entries = new Map<string, CandidateIndexEntry>();
  const lists = getLists(payload);

  for (const list of lists.filter((candidate) => candidate.listType === masterListType)) {
    for (const item of getListItems(list)) {
      const value = stringValue(item.value);
      if (!value) {
        continue;
      }

      const entry = ensureCandidate(entries, value);
      const addedCount = numberValue(item.addedCount) ?? 0;

      if (!entry.masterItemId) {
        entry.masterItemId = stringValue(item.id);
      }

      entry.addedCount = Math.max(entry.addedCount, addedCount);

      const lastAddedAt = timestampFromUnknown(item.lastAddedAt);
      if (
        lastAddedAt &&
        (!entry.masterLastAddedAt || lastAddedAt.epochMs > entry.masterLastAddedAt.epochMs)
      ) {
        entry.masterLastAddedAt = lastAddedAt;
      }
    }
  }

  for (const list of lists.filter(isShoppingList)) {
    const listId = stringValue(list.id);
    if (!listId) {
      continue;
    }

    for (const item of getListItems(list)) {
      const value = stringValue(item.value);
      const itemId = stringValue(item.id);
      if (!value || !itemId) {
        continue;
      }

      ensureCandidate(entries, value).shoppingOccurrences.push({
        listId,
        itemId,
        crossedOffAt: getCrossedOffAt(item),
      });
    }
  }

  return entries;
}

function ensureCandidate(
  entries: Map<string, CandidateIndexEntry>,
  value: string
): CandidateIndexEntry {
  const existing = entries.get(value);
  if (existing) {
    return existing;
  }

  const entry: CandidateIndexEntry = {
    value,
    addedCount: 0,
    shoppingOccurrences: [],
  };
  entries.set(value, entry);

  return entry;
}

function getNewestCrossedOffAt(entries: Map<string, CandidateIndexEntry>): number | undefined {
  let newest: number | undefined;

  for (const entry of entries.values()) {
    for (const occurrence of entry.shoppingOccurrences) {
      if (!occurrence.crossedOffAt) {
        continue;
      }

      newest =
        newest === undefined
          ? occurrence.crossedOffAt.epochMs
          : Math.max(newest, occurrence.crossedOffAt.epochMs);
    }
  }

  return newest;
}

function significantQueryTokens(normalizedQuery: string): string[] {
  const tokens = tokenize(normalizedQuery);
  const significantTokens = tokens.filter((token) => !queryStopWords.has(token));

  return significantTokens.length > 0 ? significantTokens : tokens;
}

function tokenize(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function classifyMatch(
  value: string,
  normalizedQuery: string,
  queryTokens: string[]
): ItemMatch | undefined {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue || !normalizedQuery) {
    return undefined;
  }

  if (normalizedValue === normalizedQuery) {
    return {
      type: "exact",
      matchedText: value,
      normalizedQuery,
      normalizedValue,
    };
  }

  if (
    normalizedValue.startsWith(normalizedQuery) ||
    (normalizedValue.length >= 3 && normalizedQuery.startsWith(normalizedValue))
  ) {
    return {
      type: "prefix",
      matchedText: value,
      normalizedQuery,
      normalizedValue,
    };
  }

  const valueTokens = tokenize(normalizedValue);
  const matchedWord = valueTokens.find((valueToken) =>
    queryTokens.some(
      (queryToken) =>
        valueToken === queryToken ||
        (queryToken.length >= 3 && valueToken.startsWith(queryToken)) ||
        (valueToken.length >= 3 && queryToken.startsWith(valueToken))
    )
  );

  if (matchedWord) {
    return {
      type: "word",
      matchedText: matchedWord,
      normalizedQuery,
      normalizedValue,
    };
  }

  if (
    normalizedValue.includes(normalizedQuery) ||
    (normalizedValue.length >= 3 && normalizedQuery.includes(normalizedValue))
  ) {
    return {
      type: "substring",
      matchedText: value,
      normalizedQuery,
      normalizedValue,
    };
  }

  return undefined;
}

function toResolvedCandidate(
  entry: CandidateIndexEntry,
  match: ItemMatch,
  context: ScoringContext
): ResolvedItemCandidate {
  const targetList = context.listId ? getTargetListEvidence(entry, context.listId) : undefined;
  const latestCrossedOffAt = getLatestCrossedOffAt(entry.shoppingOccurrences);
  const listCount = new Set(entry.shoppingOccurrences.map((occurrence) => occurrence.listId)).size;
  const score = calculateScore(entry, match, context, targetList, latestCrossedOffAt);
  const candidate: ResolvedItemCandidate = {
    value: entry.value,
    score,
    confidence: confidenceFor(score, match.type),
    match,
    addedCount: entry.addedCount,
    history: {
      shoppingOccurrenceCount: entry.shoppingOccurrences.length,
      listCount,
    },
    recommendedAction: recommendedAction(entry.value, context.listId, targetList),
  };

  if (entry.masterItemId) {
    candidate.masterItemId = entry.masterItemId;
  }

  if (entry.masterLastAddedAt) {
    candidate.masterLastAddedAt = entry.masterLastAddedAt;
  }

  if (latestCrossedOffAt) {
    candidate.history.lastCrossedOffAt = latestCrossedOffAt;
  }

  if (targetList) {
    candidate.targetList = targetList;
  }

  return candidate;
}

function calculateScore(
  entry: CandidateIndexEntry,
  match: ItemMatch,
  context: ScoringContext,
  targetList: TargetListEvidence | undefined,
  latestCrossedOffAt: Timestamp | undefined
): number {
  let score = textMatchScore(match.type);
  score += Math.min(Math.log1p(entry.addedCount) * 4, 20);

  if (context.listId) {
    const targetOccurrences = entry.shoppingOccurrences.filter(
      (occurrence) => occurrence.listId === context.listId
    );
    score += Math.min(targetOccurrences.length * 3, 12);

    const targetCrossedOffAt = getLatestCrossedOffAt(
      targetOccurrences.filter((occurrence) => occurrence.crossedOffAt)
    );

    if (targetList?.status === "crossed_off") {
      score += 15;
      score += recencyScore(targetCrossedOffAt, context.newestCrossedOffAt, 14);
    } else if (targetList?.status === "active") {
      score -= 15;
    }
  }

  score += recencyScore(latestCrossedOffAt, context.newestCrossedOffAt, 8);

  return Math.round(score * 100) / 100;
}

function textMatchScore(type: ItemMatchType): number {
  switch (type) {
    case "exact":
      return 100;
    case "prefix":
      return 85;
    case "word":
      return 70;
    case "substring":
      return 55;
  }
}

function matchRank(type: ItemMatchType): number {
  switch (type) {
    case "exact":
      return 4;
    case "prefix":
      return 3;
    case "word":
      return 2;
    case "substring":
      return 1;
  }
}

function getTargetListEvidence(entry: CandidateIndexEntry, listId: string): TargetListEvidence {
  const occurrences = entry.shoppingOccurrences.filter(
    (occurrence) => occurrence.listId === listId
  );
  const activeOccurrence = occurrences.find((occurrence) => !occurrence.crossedOffAt);
  if (activeOccurrence) {
    return {
      status: "active",
      itemId: activeOccurrence.itemId,
    };
  }

  const crossedOffOccurrence = occurrences
    .filter((occurrence) => occurrence.crossedOffAt)
    .sort(
      (left, right) => (right.crossedOffAt?.epochMs ?? 0) - (left.crossedOffAt?.epochMs ?? 0)
    )[0];

  if (crossedOffOccurrence?.crossedOffAt) {
    return {
      status: "crossed_off",
      itemId: crossedOffOccurrence.itemId,
      crossedOffAt: crossedOffOccurrence.crossedOffAt,
    };
  }

  return {
    status: "not_found",
  };
}

function getLatestCrossedOffAt(occurrences: ShoppingOccurrence[]): Timestamp | undefined {
  return occurrences.reduce<Timestamp | undefined>((latest, occurrence) => {
    if (!occurrence.crossedOffAt) {
      return latest;
    }

    if (!latest || occurrence.crossedOffAt.epochMs > latest.epochMs) {
      return occurrence.crossedOffAt;
    }

    return latest;
  }, undefined);
}

function recencyScore(
  timestamp: Timestamp | undefined,
  newestCrossedOffAt: number | undefined,
  maxScore: number
): number {
  if (!timestamp || newestCrossedOffAt === undefined) {
    return 0;
  }

  const ageDays = Math.max(0, (newestCrossedOffAt - timestamp.epochMs) / millisecondsPerDay);

  if (ageDays <= 7) {
    return maxScore;
  }

  if (ageDays <= 30) {
    return maxScore * 0.8;
  }

  if (ageDays <= 90) {
    return maxScore * 0.6;
  }

  if (ageDays <= 180) {
    return maxScore * 0.4;
  }

  if (ageDays <= 365) {
    return maxScore * 0.25;
  }

  return maxScore * 0.1;
}

function confidenceFor(score: number, matchType: ItemMatchType): "high" | "medium" | "low" {
  if (score >= 95 || (matchType === "exact" && score >= 80)) {
    return "high";
  }

  if (score >= 70) {
    return "medium";
  }

  return "low";
}

function recommendedAction(
  value: string,
  listId: string | undefined,
  targetList: TargetListEvidence | undefined
): RecommendedAction {
  if (!listId) {
    return {
      type: "choose_list",
      value,
    };
  }

  if (targetList?.status === "active") {
    return {
      type: "already_active",
      listId,
      itemId: targetList.itemId,
    };
  }

  if (targetList?.status === "crossed_off") {
    return {
      type: "uncross_item",
      listId,
      itemId: targetList.itemId,
    };
  }

  return {
    type: "add_item",
    listId,
    value,
  };
}
