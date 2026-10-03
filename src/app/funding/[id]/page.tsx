import FundingReturn from '@/components/action/funding-return';

export default async function FundingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ canceled?: string | string[] }>;
}) {
  const { id } = await params;
  const { canceled } = await searchParams;
  return <FundingReturn id={id} canceled={canceled === '1'} />;
}
