import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { OperatingSystem } from '@/components/operating-system';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <OperatingSystem />;
}
