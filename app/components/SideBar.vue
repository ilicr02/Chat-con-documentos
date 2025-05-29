<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useFileDialog, useDropZone } from '@vueuse/core'
import { useSupabaseClient, useSupabaseUser, useToast, useRuntimeConfig } from '#imports'

// Definición de tipos
interface Document {
  id: string
  name: string
  size: number
  storage_path: string
  public_url: string
  status: string
  created_at: string
  chunks?: number
  progress?: string
}

interface UploadingDocument {
  name: string
  size: number
  progress: number
  id: string
}

// Declaración de emits
const emit = defineEmits<{
  (e: 'hideDrawer'): void
}>()

const supabase = useSupabaseClient()
const _user = useSupabaseUser() // Prefijo _ para variable no usada
const toast = useToast()
const loading = ref(false)
const documents = ref<Document[]>([])
const dropZoneRef = ref<HTMLDivElement>()

// Estado para documentos en proceso de carga
const uploadingDocuments = ref<UploadingDocument[]>([])

// Documentos combinados (subidos + en proceso)
const _allDocuments = computed(() => [
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

// Configuración de zona de drop
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: handleFiles,
  dataTypes: ['application/pdf'],
  multiple: true,
})

const { open, onChange, reset } = useFileDialog({
  accept: 'application/pdf',
})
onChange((files: FileList | null) => {
  if (files && files.length > 0) {
    handleFiles(files)
  }
})

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
  catch (error: unknown) {
    console.error('Error loading documents:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to load documents: ' + (error instanceof Error ? error.message : 'Unknown error'),
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

// Manejo de archivos con tipo seguro
async function handleFiles(files: FileList | File[] | null) {
  if (!files || files.length === 0) return

  const validFiles = (Array.isArray(files) ? files : Array.from(files))
    .filter((f): f is File => f instanceof File && f.type === 'application/pdf')
    .filter(f => f.size <= 10 * 1024 * 1024) // 10MB max

  if (validFiles.length === 0) {
    toast.add({
      title: 'Archivos inválidos',
      description: 'Solo se aceptan PDFs menores a 10MB',
      color: 'error',
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
      await uploadFile(files[i])
    }
    await loadDocuments()
  }
  catch (error: unknown) {
    console.error('Upload error:', error)
    toast.add({
      title: 'Upload failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      color: 'error',
    })
  }
  finally {
    uploadingDocuments.value = []
    loading.value = false
    reset()
  }
}

// Subida individual con manejo de errores
async function uploadFile(file: File) {
  try {
    const config = useRuntimeConfig()
    const bucket = config.public.supabaseBucket
    const filePath = `uploads/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

    // 1. Subir archivo
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
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
      color: 'success',
    })
  }
  catch (error: unknown) {
    console.error('Error uploading file:', error)
    throw new Error(`Failed to upload ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
        @click="emit('hideDrawer')"
      />
    </div>
    <USeparator />
    <div class="p-4 space-y-6 overflow-y-auto flex flex-col">
      <UCard
        ref="dropZoneRef"
        class="transition-all flex flex-grow mb-2 cursor-pointer hover:ring-emerald-500"
        :class="{ 'ring-blue-500 ring-opacity-50': isOverDropZone }"
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
      <div v-for="(document, i) in documents" :key="document.id" class="py-1">
        <p class="font-medium text-sm mb-1 truncate text-zinc-700 dark:text-zinc-300">
          {{ document.name }}
        </p>
        <p class="text-zinc-500 text-xs">
          {{ (document.size / (1024 * 1024)).toFixed(2) }} MB
          <template v-if="document.chunks">
            &#x2022; {{ document.chunks }} chunks
          </template>
        </p>
        <div v-if="document.progress" class="mt-0.5 flex items-center px-1.5 gap-2">
          <LoadingIcon class="size-2" />
          <p class="text-zinc-400 text-xs">
            {{ document.progress }}
          </p>
        </div>

        <USeparator v-if="i < documents.length - 1" class="mt-3" />
      </div>

      <p v-if="!documents.length" class="text-zinc-700 dark:text-zinc-300">
        No se han subido documentos
      </p>
    </div>

    <USeparator />
    <div class="p-2" />
  </div>
</template>
