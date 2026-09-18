// ─── Logic Engine ────────────────────────────────────────────────────────

type FlowNode =
  | { type: 'if'; condition: FlowCondition; then: FlowNode; else?: FlowNode }
  | { type: 'sequence'; steps: FlowNode[] }
  | { type: 'event'; name: string; args?: Record<string, unknown> }
  | { type: 'set'; key: string; value: unknown };

interface FlowCondition {
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'and' | 'or' |
      'exists' | 'not_exists' | 'contains' | 'starts_with' | 'ends_with' |
      'in_list' | 'not_in_list' | 'between' | 'is_true' | 'is_false';
  left?: { from: string };
  right?: unknown;
  value?: { from: string };
  conditions?: FlowCondition[];
}

export interface FlowResult {
  hasEvent: boolean;
  eventName?: string;
  args: Record<string, unknown>;
  completed: boolean;
  error?: string;
}

interface FlowContext {
  context: Record<string, unknown>;
  config: Record<string, unknown>;
  flags: Record<string, boolean>;
}

export class KoolbaseLogicEngine {
  // ─── Public API ───────────────────────────────────────────────────────────

  execute(
    flowId: string,
    flows: Record<string, unknown>,
    context: Record<string, unknown>,
    config: Record<string, unknown>,
    flags: Record<string, boolean>,
  ): FlowResult {
    try {
      const flowJson = flows[flowId];
      if (!flowJson) {
        return { hasEvent: false, args: {}, completed: true };
      }

      const ctx: FlowContext = {
        context: { ...context },
        config,
        flags,
      };

      return this.evalNode(flowJson as FlowNode, ctx);
    } catch (e) {
      return {
        hasEvent: false,
        args: {},
        completed: false,
        error: String(e),
      };
    }
  }

  // ─── Node evaluation ──────────────────────────────────────────────────────

  private evalNode(node: FlowNode, ctx: FlowContext): FlowResult {
    switch (node.type) {
      case 'if':
        return this.evalIf(node, ctx);
      case 'sequence':
        return this.evalSequence(node, ctx);
      case 'event':
        return { hasEvent: true, eventName: node.name, args: node.args ?? {}, completed: true };
      case 'set':
        this.setNested(ctx.context, node.key, node.value);
        return { hasEvent: false, args: {}, completed: true };
      default:
        return { hasEvent: false, args: {}, completed: true };
    }
  }

  private evalIf(node: Extract<FlowNode, { type: 'if' }>, ctx: FlowContext): FlowResult {
    const result = this.evalCondition(node.condition, ctx);
    if (result) return this.evalNode(node.then, ctx);
    if (node.else) return this.evalNode(node.else, ctx);
    return { hasEvent: false, args: {}, completed: true };
  }

  private evalSequence(node: Extract<FlowNode, { type: 'sequence' }>, ctx: FlowContext): FlowResult {
    for (const step of node.steps) {
      const result = this.evalNode(step, ctx);
      if (result.hasEvent) return result;
    }
    return { hasEvent: false, args: {}, completed: true };
  }

  // ─── Condition evaluation ─────────────────────────────────────────────────

  private evalCondition(condition: FlowCondition, ctx: FlowContext): boolean {
    switch (condition.op) {
      case 'eq': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        return String(left) === String(condition.right);
      }
      case 'neq': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        return String(left) !== String(condition.right);
      }
      case 'gt': {
        const left = Number(condition.left ? this.resolve(condition.left.from, ctx) : undefined);
        const right = Number(condition.right);
        return !isNaN(left) && !isNaN(right) && left > right;
      }
      case 'lt': {
        const left = Number(condition.left ? this.resolve(condition.left.from, ctx) : undefined);
        const right = Number(condition.right);
        return !isNaN(left) && !isNaN(right) && left < right;
      }
      case 'and':
        return (condition.conditions ?? []).every((c) => this.evalCondition(c, ctx));
      case 'or':
        return (condition.conditions ?? []).some((c) => this.evalCondition(c, ctx));
      case 'exists': {
        const val = condition.value ? this.resolve(condition.value.from, ctx) : undefined;
        return val !== null && val !== undefined;
      }
      case 'not_exists': {
        const val = condition.value ? this.resolve(condition.value.from, ctx) : undefined;
        return val === null || val === undefined;
      }
      case 'gte': {
        const left = Number(condition.left ? this.resolve(condition.left.from, ctx) : undefined);
        const right = Number(condition.right);
        return !isNaN(left) && !isNaN(right) && left >= right;
      }
      case 'lte': {
        const left = Number(condition.left ? this.resolve(condition.left.from, ctx) : undefined);
        const right = Number(condition.right);
        return !isNaN(left) && !isNaN(right) && left <= right;
      }
      case 'contains': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        const right = condition.right;
        if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
        if (Array.isArray(left)) return left.includes(right);
        return false;
      }
      case 'starts_with': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        const right = String(condition.right ?? '');
        return typeof left === 'string' && left.startsWith(right);
      }
      case 'ends_with': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        const right = String(condition.right ?? '');
        return typeof left === 'string' && left.endsWith(right);
      }
      case 'in_list': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        const list = condition.right;
        if (!Array.isArray(list)) return false;
        return list.some((item) => String(item) === String(left));
      }
      case 'not_in_list': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        const list = condition.right;
        if (!Array.isArray(list)) return true;
        return !list.some((item) => String(item) === String(left));
      }
      case 'between': {
        const left = Number(condition.left ? this.resolve(condition.left.from, ctx) : undefined);
        const range = condition.right;
        if (!Array.isArray(range) || range.length < 2) return false;
        const min = Number(range[0]);
        const max = Number(range[1]);
        return !isNaN(left) && !isNaN(min) && !isNaN(max) && left >= min && left <= max;
      }
      case 'is_true': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        return left === true || left === 'true';
      }
      case 'is_false': {
        const left = condition.left ? this.resolve(condition.left.from, ctx) : undefined;
        return left === false || left === 'false';
      }
      default:
        return false;
    }
  }

  // ─── Data resolution ──────────────────────────────────────────────────────

  private resolve(from: string, ctx: FlowContext): unknown {
    const dotIdx = from.indexOf('.');
    if (dotIdx === -1) return undefined;
    const source = from.substring(0, dotIdx);
    const key = from.substring(dotIdx + 1);

    switch (source) {
      case 'context': return this.getNested(ctx.context, key);
      case 'config': return this.getNested(ctx.config, key);
      case 'flags': return ctx.flags[key];
      default: return undefined;
    }
  }

  private getNested(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setNested(obj: Record<string, unknown>, key: string, value: unknown): void {
    const parts = key.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
}
