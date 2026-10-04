import { redirect } from 'next/navigation';

// Root (served at /notes via basePath) → dashboard
export default function Home() {
  redirect('/notes');
}
