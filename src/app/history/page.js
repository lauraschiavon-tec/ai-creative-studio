import AppShell from '@/components/AppShell';
import HistoryList from '@/components/HistoryList';

export const dynamic = 'force-dynamic';

export default function History() {
  return (
    <AppShell active="history">
      <div className="pagehead"><h1>Histórico</h1><span className="muted">Suas gerações, com modelo, parâmetros, data e custo.</span></div>
      <HistoryList />
    </AppShell>
  );
}
