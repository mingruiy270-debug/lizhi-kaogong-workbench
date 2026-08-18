import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import { invoke } from '../api'

function VaultImage(props: {
  src?: string
  alt?: string
  sourceFilePath?: string
}): React.JSX.Element {
  const [resolved, setResolved] = useState(props.src?.startsWith('data:image/') ? props.src : '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!props.src || props.src.startsWith('data:image/')) return
    if (!props.sourceFilePath || /^[a-z][a-z0-9+.-]*:/i.test(props.src)) {
      setFailed(true)
      return
    }
    setFailed(false)
    setResolved('')
    void invoke<string>({
      method: 'vault.asset',
      params: { sourceFilePath: props.sourceFilePath, assetPath: props.src }
    })
      .then(setResolved)
      .catch(() => setFailed(true))
  }, [props.src, props.sourceFilePath])
  if (failed) return <span className="muted">图片不可用：{props.alt || props.src}</span>
  if (!resolved) return <span className="muted">正在读取图片：{props.alt || '未命名图片'}</span>
  return <img src={resolved} alt={props.alt ?? ''} loading="lazy" />
}

export function MarkdownContent(props: {
  content: string
  sourceFilePath?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`markdown ${props.className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt }) => (
            <VaultImage src={src} alt={alt} sourceFilePath={props.sourceFilePath} />
          )
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  )
}
