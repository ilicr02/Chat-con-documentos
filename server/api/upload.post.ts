export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)
  const fileData = formData?.find((f) => f.name === 'file')
  const sessionIdData = formData?.find((f) => f.name === 'sessionId')?.data

  if (!fileData || !sessionIdData) {
    throw createError({ 
      statusCode: 400, 
      message: 'Missing file or sessionId',
      data: {
        formData: formData?.map(f => ({ name: f.name, filename: f.filename }))
      }
    })
  }

  const sessionId = sessionIdData.toString()
  const file = new File([fileData.data], fileData.filename || 'document.pdf', {
    type: fileData.type || 'application/pdf',
  })

  const eventStream = createEventStream(event)
  const streamResponse = (data: object) => eventStream.push(JSON.stringify(data))

  event.waitUntil((async () => {
    try {
      streamResponse({ message: 'Validating PDF...' })

      // Verificar tamaño del archivo (ejemplo: máximo 10MB)
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size exceeds 10MB limit')
      }

      streamResponse({ message: 'Starting PDF processing...' })

      const [storageUrl, textContent] = await Promise.all([
        uploadPDFToSupabase(file, sessionId).catch(err => {
          throw new Error(`Storage upload failed: ${err.message}`)
        }),
        extractTextFromPDF(file).catch(err => {
          throw new Error(`Text extraction failed: ${err.message}`)
        }),
      ])

      streamResponse({ message: 'PDF uploaded and text extracted' })

      const insertResult = await insertDocument(file, textContent, sessionId, storageUrl)
      const insertedId = insertResult[0]?.insertedId
      
      if (!insertedId) {
        throw new Error('Database insertion failed: No document ID returned')
      }
      
      streamResponse({ message: `Document stored with ID: ${insertedId}` })

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 100,
      })
      const chunks = await splitter.splitText(textContent)
      streamResponse({ message: `Text split into ${chunks.length} chunks` })

      await processVectors(chunks, sessionId, insertedId, streamResponse)
      streamResponse({ success: true, chunks: chunks.length })
    }
    catch (error: unknown) {
      console.error('Full upload error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      streamResponse({
        error: errorMessage,
        ...(process.dev ? { stack: error instanceof Error ? error.stack : undefined } : {}),
      })
    }
    finally {
      eventStream.close()
    }
  })())

  return eventStream.send()
})