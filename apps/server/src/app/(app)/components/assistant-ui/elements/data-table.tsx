import type { ReactNode } from 'react'
import { Table } from '../../ui/table'

export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: string[]
  rows: { key: string; cells: ReactNode[] }[]
}) {
  return (
    <Table data-slot="data-table" aria-label={caption}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => (
              <td key={columns[index]}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
