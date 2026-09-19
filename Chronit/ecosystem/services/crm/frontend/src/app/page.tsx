import { redirect } from 'next/navigation';

// El CRM arranca directamente en el resumen centralizado.
export default function Home() {
  redirect('/crm');
}
