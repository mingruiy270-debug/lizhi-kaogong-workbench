import { useEffect, useMemo, useState } from 'react'
import { Field, Input } from '@fluentui/react-components'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import type { KnowledgeDocument, Subject } from '@shared/contracts'
import { invoke } from '../api'
import { MarkdownContent } from '../components/MarkdownContent'
import { EmptyState, ErrorState, LoadingState, PageHeader, Section } from '../components/ui'

interface KnowledgePageProps {
  subject: Subject
  kind: 'knowledge' | 'method'
}

export function KnowledgePage({ subject, kind }: KnowledgePageProps): React.JSX.Element {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>()
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setDocuments(undefined)
    setError('')
    void invoke<KnowledgeDocument[]>({ method: 'documents.list', params: { subject, kind } })
      .then((items) => {
        setDocuments(items)
        setSelectedId(items[0]?.id ?? '')
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '文档读取失败'))
  }, [subject, kind])
  const filtered = useMemo(
    () =>
      documents?.filter(
        (document) =>
          !query.trim() ||
          `${document.title}${document.summary}${document.tags.join('')}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
      ) ?? [],
    [documents, query]
  )
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]
  const title = `${subject === 'xingce' ? '行测' : '申论'}${kind === 'knowledge' ? '知识' : '方法'}中心`
  if (error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState message={error} />
      </div>
    )
  return (
    <div className="page">
      <PageHeader
        eyebrow="KNOWLEDGE"
        title={title}
        description="直接读取当前 Markdown 知识库，保留标题、列表、表格与公式结构。"
      />
      {!documents ? (
        <LoadingState label="正在读取知识文档" />
      ) : !documents.length ? (
        <EmptyState
          title="当前分类没有文档"
          description="在知识库 Markdown frontmatter 中设置 subject 与 kind 后重新索引。"
        />
      ) : (
        <Section className="document-layout">
          <div className="document-list">
            <Field label="搜索文档">
              <Input
                value={query}
                contentBefore={<MagnifyingGlassIcon />}
                onChange={(_, data) => setQuery(data.value)}
                placeholder="标题、摘要或标签"
              />
            </Field>
            <div style={{ marginTop: 12 }}>
              {filtered.map((document) => (
                <button
                  type="button"
                  className={`document-item ${selected?.id === document.id ? 'active' : ''}`}
                  key={document.id}
                  onClick={() => setSelectedId(document.id)}
                >
                  <strong>{document.title}</strong>
                  <small>{document.summary}</small>
                </button>
              ))}
            </div>
          </div>
          <article className="document-content">
            {selected ? (
              <MarkdownContent content={selected.content} sourceFilePath={selected.filePath} />
            ) : (
              <EmptyState title="没有匹配文档" description="尝试缩短搜索词。" />
            )}
          </article>
        </Section>
      )}
    </div>
  )
}

export function PatternsPage(): React.JSX.Element {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>()
  const [selectedId, setSelectedId] = useState('')
  useEffect(() => {
    void invoke<KnowledgeDocument[]>({
      method: 'documents.list',
      params: { kind: 'pattern' }
    }).then((items) => {
      setDocuments(items)
      setSelectedId(items[0]?.id ?? '')
    })
  }, [])
  const selected = documents?.find((item) => item.id === selectedId)
  return (
    <div className="page">
      <PageHeader
        eyebrow="PATTERNS"
        title="规律中心"
        description="把跨模块可复用的错因、检查步骤和思维模式集中起来。"
      />
      {!documents ? (
        <LoadingState />
      ) : !documents.length ? (
        <EmptyState
          title="还没有规律文档"
          description="在 Markdown frontmatter 中设置 kind: pattern 后重新索引。"
        />
      ) : (
        <div className="grid two">
          {documents.map((document) => (
            <Section
              key={document.id}
              title={document.title}
              description={document.summary}
              actions={
                <button type="button" className="pill" onClick={() => setSelectedId(document.id)}>
                  展开
                </button>
              }
            >
              {selectedId === document.id ? (
                <MarkdownContent content={document.content} sourceFilePath={document.filePath} />
              ) : (
                <div className="button-row">
                  {document.tags.map((tag) => (
                    <span className="pill" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          ))}
        </div>
      )}
      {selected && documents && documents.length > 4 && (
        <Section title={selected.title}>
          <MarkdownContent content={selected.content} sourceFilePath={selected.filePath} />
        </Section>
      )}
    </div>
  )
}
