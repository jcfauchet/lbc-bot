'use client'

import { useState } from 'react'

interface Props {
  listingId: string
  initialFeedbackId?: string | null
  initialVote?: 'good' | 'bad' | null
  placeholder?: string
}

export function FeedbackButton({
  listingId,
  initialFeedbackId = null,
  initialVote = null,
  placeholder = 'Pourquoi ? (optionnel)',
}: Props) {
  const [feedbackId, setFeedbackId] = useState<string | null>(initialFeedbackId)
  const [vote, setVote] = useState<'good' | 'bad' | null>(initialVote)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleVote = async (v: 'good' | 'bad') => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, vote: v }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (data.id) setFeedbackId(data.id)
      setVote(v)
      setShowComment(true)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackId || !comment.trim()) return
    await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: feedbackId, comment: comment.trim() }),
    })
    setSubmitted(true)
    setShowComment(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-0.5 items-center">
        <button
          onClick={() => handleVote('good')}
          disabled={loading}
          className={`text-base px-1 rounded transition-opacity cursor-pointer ${
            vote === 'good' ? 'opacity-100' : vote === null ? 'opacity-30 hover:opacity-70' : 'opacity-10'
          }`}
          title="Bon produit"
        >
          👍
        </button>
        <button
          onClick={() => handleVote('bad')}
          disabled={loading}
          className={`text-base px-1 rounded transition-opacity cursor-pointer ${
            vote === 'bad' ? 'opacity-100' : vote === null ? 'opacity-30 hover:opacity-70' : 'opacity-10'
          }`}
          title="Pas bon"
        >
          👎
        </button>
        {submitted && <span className="text-xs text-green-600 ml-1">✓</span>}
      </div>

      {showComment && !submitted && (
        <form onSubmit={handleCommentSubmit} className="flex flex-col gap-1 mt-0.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={placeholder}
            className="text-xs border border-gray-200 rounded p-1 w-36 resize-none focus:outline-none focus:border-gray-400"
            rows={2}
            autoFocus
          />
          <div className="flex gap-1 items-center">
            <button
              type="submit"
              disabled={!comment.trim()}
              className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded disabled:opacity-40"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setShowComment(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Passer
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
