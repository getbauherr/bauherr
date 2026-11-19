import { EmptyState } from '../components/EmptyState'

export default function Home() {
  return (
    <>
      <h1 className="sr-only">Home</h1>
      <EmptyState text="No project is connected to the lean core yet." action={{ href: '/settings/products', label: 'Open Products settings' }} />
    </>
  )
}
