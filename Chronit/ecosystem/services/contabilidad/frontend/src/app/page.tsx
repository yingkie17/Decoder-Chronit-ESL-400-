import { redirect } from 'next/navigation';

// El panel contable arranca directamente en la consola financiera.
export default function Home() {
  redirect('/contabilidad');
}
