import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView, ScrollView, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import {
  Koolbase,
  KoolbaseOfflineBaselineUnavailableError,
} from '@koolbase/react-native';

const CONFIG = {
  publicKey: 'pk_test_76a8e292268c362133314b1f',
  baseUrl: 'https://api.koolbase.com',
};

const USER1 = { email: 'kennedy+1785656351348@probe.test', password: 'Test1234!' };
const USER2 = { email: 'kennedy+1785657504843@probe.test', password: 'Test1234!' };
const COLLECTION = 'rn_expenses';

type Rec = { id: string; [k: string]: unknown };

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [who, setWho] = useState<string>('null');
  const [records, setRecords] = useState<Rec[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);

  const append = useCallback((line: string) => {
    setLog(prev => [...prev.slice(-200), `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  const refreshWho = () => setWho(Koolbase.auth.currentUser?.email ?? 'null');

  useEffect(() => {
    (async () => {
      try {
        await Koolbase.initialize(CONFIG);
        setReady(true);
        append('✓ initialize() ok');
        const r = await Koolbase.auth.restoreSession();
        append(`restore → ${JSON.stringify(r)}`);
        refreshWho();
        // Per-user state has no answer without a user — only ask signed in.
        if (Koolbase.auth.currentUser) {
          await refreshConflicts();
        }
      } catch (e: any) {
        append(`✗ init: ${e?.name} — ${e?.message}`);
      }
    })();
  }, []);

  const login = async (u: typeof USER1, label: string) => {
    try {
      await Koolbase.auth.login(u);
      refreshWho();
      append(`✓ login ${label}`);
    } catch (e: any) { append(`✗ login ${label}: ${e?.name} — ${e?.message}`); }
  };

  const logout = async () => {
    try { await Koolbase.auth.logout(); refreshWho(); append('✓ logout'); }
    catch (e: any) { append(`✗ logout: ${e?.name} — ${e?.message}`); }
  };

  const doInsert = async () => {
    try {
      const rec = await Koolbase.db.insert(COLLECTION, {
        title: `exp-${Date.now() % 100000}`,
        amount: 10,
      });
      append(`✓ insert → ${rec.id}`);
      setRecords(prev => [rec as Rec, ...prev]);
      // If this happened offline, insert resolves optimistically = queued.
    } catch (e: any) {
      append(`✗ insert: ${e?.name} — ${e?.message}`);
    }
  };

  const doQuery = async () => {
    try {
      const res = await Koolbase.db.query(COLLECTION, {
        limit: 20, orderBy: 'created_at', orderDesc: true,
      });
      setRecords(res.records as Rec[]);
      append(`✓ query → ${res.records.length}/${res.total}${res.isFromCache ? ' (FROM CACHE)' : ' (server)'}`);
    } catch (e: any) { append(`✗ query: ${e?.name} — ${e?.message}`); }
  };

  const doUpdate = async () => {
    if (!selected) { append('· select a record first'); return; }
    try {
      const rec = await Koolbase.db.update(selected, { amount: Math.floor(Math.random() * 90) + 10 });
      append(`✓ update ${short(selected)} → amount=${(rec as any)?.data?.amount ?? '?'}`);
    } catch (e: any) {
      if (e instanceof KoolbaseOfflineBaselineUnavailableError) {
        append(`✗ update REFUSED (baseline unavailable) — nothing queued`);
      } else {
        append(`✗ update: ${e?.name} — ${e?.message}`);
      }
    }
  };

  const doDelete = async () => {
    if (!selected) { append('· select a record first'); return; }
    try {
      await Koolbase.db.delete(selected);
      append(`✓ delete ${short(selected)}`);
      setSelected(null);
    } catch (e: any) {
      if (e instanceof KoolbaseOfflineBaselineUnavailableError) {
        append(`✗ delete REFUSED (baseline unavailable) — nothing queued`);
      } else {
        append(`✗ delete: ${e?.name} — ${e?.message}`);
      }
    }
  };

  const doSync = async () => {
    try {
      append('… syncPendingWrites()');
      await Koolbase.db.syncPendingWrites();
      append('✓ sync pass complete');
      await refreshConflicts();
    } catch (e: any) { append(`✗ sync: ${e?.name} — ${e?.message}`); }
  };

  const doPending = async () => {
    try {
      const pending = await Koolbase.db.pendingWrites();
      append(`pending: ${pending.length}`);
      for (const w of pending) {
        append(`  ⏳ ${w.operation} ${w.collection} wid=${w.id} rec=${w.recordId ?? '-'} attempts=${w.attempts}`);
      }
    } catch (e: any) { append(`✗ pendingWrites: ${e?.name} — ${e?.message}`); }
  };

  const refreshConflicts = async () => {
    try {
      const list = await Koolbase.db.conflicts();
      setConflictCount(list.length);
      if (list.length) {
        for (const c of list) {
          append(`⚠ conflict ${short(c.id)} [${c.reason}] ${c.operation} on ${short(c.recordId)}`);
        }
      }
      return list;
    } catch (e: any) { append(`✗ conflicts(): ${e?.name} — ${e?.message}`); return []; }
  };

  const resolveFirst = async (how: 'local' | 'server' | 'merge' | 'abandon') => {
    const list = await refreshConflicts();
    if (!list.length) { append('· no conflicts'); return; }
    const c = list[0];
    try {
      if (how === 'local') await c.resolveWithLocal();
      if (how === 'server') await c.resolveWithServer();
      if (how === 'abandon') await c.abandon();
      if (how === 'merge') await c.resolveWithMerge({ amount: 777, title: 'merged-by-probe' });
      append(`✓ resolved ${short(c.id)} with ${how}`);
      await refreshConflicts();
    } catch (e: any) { append(`✗ resolve ${how}: ${e?.name} — ${e?.message}`); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container}>
        <Text style={s.title}>Koolbase RN — Expense Probe</Text>
        <Text style={s.status}>
          init: {ready ? 'ready' : 'pending'} · user: {who} · conflicts: {conflictCount}
        </Text>

        <Row><B t="Login U1" f={() => login(USER1, 'U1')} /><B t="Login U2" f={() => login(USER2, 'U2')} /><B t="Logout" f={logout} /></Row>
        <Row><B t="Insert" f={doInsert} /><B t="Query" f={doQuery} /></Row>
        <Row><B t="Update sel" f={doUpdate} /><B t="Delete sel" f={doDelete} /></Row>
        <Row><B t="Sync now" f={doSync} /><B t="Pending?" f={doPending} /><B t="Conflicts?" f={refreshConflicts} /></Row>
        <Row><B t="Res:local" f={() => resolveFirst('local')} /><B t="Res:server" f={() => resolveFirst('server')} /><B t="Res:merge" f={() => resolveFirst('merge')} /><B t="Res:aband" f={() => resolveFirst('abandon')} /></Row>

        <Text style={s.logHeader}>Records (tap to select)</Text>
        {records.map(r => (
          <TouchableOpacity key={r.id} onPress={() => { setSelected(r.id); append(`· selected ${short(r.id)}`); }}>
            <Text style={[s.rec, selected === r.id && s.recSel]}>
              {short(r.id)}  {String((r.data as any)?.title ?? '')}  amt={String((r.data as any)?.amount ?? '?')}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={s.logHeader}>Log</Text>
        {log.map((l, i) => <Text key={i} style={s.logLine}>{l}</Text>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const short = (id: string) => id.slice(0, 8);

function Row({ children }: { children: React.ReactNode }) {
  return <View style={s.row}>{children}</View>;
}
function B({ t, f }: { t: string; f: () => void }) {
  return (
    <TouchableOpacity style={s.btn} onPress={f}>
      <Text style={s.btnText}>{t}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 16, gap: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  status: { color: '#8ab4f8', fontSize: 12 },
  row: { flexDirection: 'row', gap: 6 },
  btn: { flex: 1, backgroundColor: '#2d6cdf', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  rec: { color: '#c9c9d4', fontSize: 12, fontFamily: 'monospace', paddingVertical: 3 },
  recSel: { color: '#7ee787', fontWeight: '700' },
  logHeader: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 10 },
  logLine: { color: '#c9c9d4', fontSize: 11, fontFamily: 'monospace' },
});
