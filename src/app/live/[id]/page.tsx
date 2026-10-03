'use client';

// Requester / big-screen view of one live video task.
import { useParams } from 'next/navigation';
import LiveView from '@/components/delegate/live-view';

export default function LivePage() {
  const { id } = useParams<{ id: string }>();
  return <LiveView taskId={id} />;
}
