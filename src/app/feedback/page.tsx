'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, Suspense } from 'react'

function FeedbackContent() {
  const searchParams = useSearchParams()
  const listingId = searchParams.get('id')
  const vote = searchParams.get('vote') as 'good' | 'bad' | null

  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasSaved = useRef(false)

  useEffect(() => {
    if (!listingId || !vote || hasSaved.current) return
    hasSaved.current = true

    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, vote }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setFeedbackId(data.id)
        setLoading(false)
      })
      .catch(() => {
        setError('Erreur lors de l\'enregistrement.')
        setLoading(false)
      })
  }, [listingId, vote])

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackId || !comment.trim()) return

    await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: feedbackId, comment: comment.trim() }),
    })
    setSubmitted(true)
  }

  if (!listingId || !vote) {
    return <p style={styles.error}>Lien invalide.</p>
  }

  const isGood = vote === 'good'

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{isGood ? '👍' : '👎'}</div>
        <h1 style={styles.title}>Merci pour ton retour !</h1>
        {loading ? (
          <p style={styles.subtitle}>Enregistrement…</p>
        ) : error ? (
          <p style={styles.error}>{error}</p>
        ) : submitted ? (
          <p style={styles.subtitle}>Commentaire enregistré. C'est noté !</p>
        ) : (
          <>
            <p style={styles.subtitle}>
              {isGood
                ? 'Contenu de voir que cette sélection était pertinente.'
                : 'Noté, cette sélection n\'était pas bonne.'}
            </p>
            <form onSubmit={handleCommentSubmit} style={styles.form}>
              <label style={styles.label}>
                Pourquoi ? (optionnel)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  isGood
                    ? 'Ex: revendu 350€ sur Selency en 2 semaines'
                    : 'Ex: trop commun, vendeur connaît la valeur…'
                }
                style={styles.textarea}
                rows={3}
              />
              <button type="submit" style={styles.button} disabled={!comment.trim()}>
                Envoyer
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  return (
    <Suspense>
      <FeedbackContent />
    </Suspense>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    fontFamily: 'Arial, sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: 12,
    padding: '40px 32px',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: '0 0 8px',
    color: '#111',
  },
  subtitle: {
    color: '#555',
    fontSize: 15,
    margin: '0 0 24px',
  },
  form: {
    textAlign: 'left',
    marginTop: 16,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#444',
    marginBottom: 6,
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 14,
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
  },
  button: {
    marginTop: 12,
    width: '100%',
    padding: '10px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
  },
}
