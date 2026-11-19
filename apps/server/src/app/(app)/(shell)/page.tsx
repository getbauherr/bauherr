import { EmptyState } from '../components/EmptyState'

export default function Home() {
  return <EmptyState text="No project is connected to the lean core yet." action={{ href: '/settings/products', label: 'Open Products settings' }} />
}
