<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSupabaseClient, useSupabaseUser } from '#imports'
import { useToast } from '#imports'
import { useFileDialog, useDropZone } from '@vueuse/core'
import type { Document } from '~/types'
import { useExampleSessions } from '~/composables/examples'

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const toast = useToast()
const loading = ref(false)
const documents = ref<Array<Document & {
  id: string
  storage_path: string
  public_url: string
  status: string
  created_at: string
}>>([])

// Estado para documentos en proceso de carga
const uploadingDocuments = ref<Array<{
  name: string
  size: number
  progress: number
  id: string
}>>([])

// Documentos combinados (subidos + en proceso)
const allDocuments = computed(() => [
  ...uploadingDocuments.value.map(doc => ({
    ...doc,
    status: 'uploading',
    progress: `${doc.progress}%`,
    storage_path: '',
    public_url: '',
    created_at: new Date().toISOString(),
  })),
  ...documents.value,
])

// Cargar documentos con manejo de errores mejorado
async function loadDocuments() {
  try {
    loading.value = true
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    documents.value = data || []
  }
  catch (error) {
    console.error('Error loading documents:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to load documents: ' + error.message,
      color: 'red',
    })
  } finally {
    loading.value = false
  }
}

// Configuración de zona de drop
const dropZoneRef = ref<HTMLDivElement>()
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: handleFiles,
  dataTypes: ['application/pdf'],
  multiple: true,
})

const { open, onChange, reset } = useFileDialog({
  accept: 'application/pdf',
})
onChange(handleFiles)

// Manejo de archivos
async function handleFiles(files: FileList | File[] | null) {
  if (!files || files.length === 0) return

  const validFiles = Array.isArray(files) ? files : Array.from(files)
    .filter(f => f.type === 'application/pdf')
    .filter(f => f.size <= 10 * 1024 * 1024) // 10MB max

  if (validFiles.length === 0) {
    toast.add({
      title: 'Archivos inválidos',
      description: 'Solo se aceptan PDFs menores a 10MB',
      color: 'red',
    })
    return
  }

  await uploadFiles(validFiles)
}

// Función principal de subida
async function uploadFiles(files: File[]) {
  loading.value = true

  // Agregar a la lista de documentos en proceso
  uploadingDocuments.value = files.map(file => ({
    name: file.name,
    size: file.size / (1024 * 1024), // Convertir a MB
    progress: 0,
    id: `upload-${Date.now()}-${file.name}`,
  }))

  try {
    for (let i = 0; i < files.length; i++) {
      await uploadFile(files[i], i)
    }
    await loadDocuments()
  }
  catch (error) {
    console.error('Upload error:', error)
    toast.add({
      title: 'Upload failed',
      description: error.message,
      color: 'red'
    })
  } finally {
    uploadingDocuments.value = []
    loading.value = false
    reset()
  }
}

// Subida individual con manejo de errores y progreso
async function uploadFile(file: File, index: number) {
  try {
    const config = useRuntimeConfig()
    const bucket = config.public.supabaseBucket
    const filePath = `uploads/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

    // Función para actualizar progreso
    const updateProgress = (progress: number) => {
      uploadingDocuments.value[index].progress = progress
    }

    // 1. Subir archivo con seguimiento de progreso
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
        onProgress: (progress) => {
          updateProgress(Math.round((progress.loaded / progress.total) * 100))
        }
      })

    if (uploadError) throw uploadError

    // 2. Obtener URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath)

    // 3. Guardar metadatos
    const { error: dbError } = await supabase
      .from('documents')
      .insert({
        name: file.name,
        size: file.size,
        storage_path: filePath,
        public_url: publicUrl,
        status: 'uploaded',
      })

    if (dbError) throw dbError

    toast.add({
      title: 'Éxito',
      description: `${file.name} subido correctamente`,
      color: 'green',
    })
  }
  catch (error) {
    console.error('Error uploading file:', error)
    throw new Error(`Failed to upload ${file.name}: ${error.message}`)
  }
}

onMounted(() => {
  loadDocuments()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex md:hidden items-center justify-between px-4 h-14">
      <div class="flex items-center gap-x-4">
        <h2 class="md:text-lg text-zinc-600 dark:text-zinc-300">
          Documentos
        </h2>
      </div>
      <UButton
        icon="i-heroicons-x-mark-20-solid"
        color="neutral"
        variant="ghost"
        class="md:hidden"
        @click="$emit('hideDrawer')"
      />
    </div>
    <USeparator />
    <div class="p-4 space-y-6 overflow-y-auto flex flex-col">
      <UCard
        ref="dropZoneRef"
        class="transition-all flex flex-grow mb-2 cursor-pointer hover:ring-emerald-500"
        :class="{ 'ring-blue-500  ring-opacity-50': isOverDropZone }"
        :ui="{ body: 'flex flex-col items-center justify-center' }"
        @click="open"
      >
        <p class="mb-1.5 text-lg font-semibold text-primary">
          Subir un archivo
        </p>
        <p class="text-zinc-500">
          Arrastre y suelte o haga clic para cargar
        </p>
      </UCard>
    </div>

    <div class="px-4 pb-4 flex-1 space-y-2 overflow-y-auto flex flex-col">
      <h2 class="mb-2 text-lg font-semibold text-primary">
       Documentos cargados
      </h2>
      <div v-for="(document, i) in documents" :key="document.name" class="py-1">
        <p class="font-medium text-sm mb-1 truncate text-zinc-700 dark:text-zinc-300">
          {{ document.name }}
        </p>
        <p class="text-zinc-500 text-xs">
          {{ document.size }} MB
          <template v-if="document.chunks">
            &#x2022; {{ document.chunks }} chunks
          </template>
        </p>
        <div v-if="document.progress" class="mt-0.5 flex items-center px-1.5 gap-2">
          <LoadingIcon class="size-2" />
          <p class="text-zinc-400 text-xs ">
            {{ document.progress }}
          </p>
        </div>

        <USeparator v-if="i < documents.length - 1" class="mt-3" />
      </div>

      <p v-if="!documents.length" class="text-zinc-700 dark:text-zinc-300">
        No se han subido documentos
      </p>

      <p v-if="!documents.length" class="mt-3">
        Pruebe un documento de ejemplo:
      </p>
      <ul v-if="!documents.length" class="space-y-2 text-xs truncate cursor-pointer text-blue-500">
        <li v-for="example in exampleSessions" :key="example.id" @click="setExampleSession(example.id)">
          {{ example.name }}
        </li>
      </ul>
    </div>

    <USeparator />
    <div class="p-2">
      
    </div>
  </div>
</template>
