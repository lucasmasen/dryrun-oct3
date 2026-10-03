import WorkerTasks from '@/components/action/worker-tasks';

export default async function DoPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const { task } = await searchParams;
  return <WorkerTasks initialTaskId={typeof task === 'string' ? task : null} />;
}
