import { notFound } from 'next/navigation'
import { PageTitle } from '../../../../components/PageTitle'
import { TemplateEditor } from '../../../../components/TemplateEditor'
import { saveTemplate, resetTemplate } from '../../actions'
import { ago } from '../../../../lib/format'
import { isAdmin } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'
import { loadTemplate } from '../../../../lib/templates'
import { isTemplateName } from '../../../../../../lib/template-text'

export const dynamic = 'force-dynamic'

export default async function TemplatePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const { user, workspace } = await currentWorkspace()
  if (!workspace || !isTemplateName(name)) notFound()
  const t = await loadTemplate(workspace.id, name)
  return (
    <>
      <PageTitle>{t.title}</PageTitle>
      <h2 className="heading">{t.title}</h2>
      <p className="small text-muted-foreground">{t.description} Used by: {t.usedBy}.</p>
      <p className="small text-muted-foreground">{t.custom ? `Customised by ${t.custom.by ?? 'someone'}, ${ago(t.custom.at)}.` : 'The default; saving makes a version for this Workspace.'}{isAdmin(user) ? '' : ' Only an Admin can change it.'}</p>
      <TemplateEditor name={name} initial={t.body} packBody={t.packBody} layout={t.layout} custom={!!t.custom} canEdit={isAdmin(user)} save={saveTemplate} reset={resetTemplate} />
    </>
  )
}
