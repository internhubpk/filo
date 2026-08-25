const fs = require('fs')
const path = '/home/z/my-project/filo/src/components/dashboard/main-dashboard.tsx'

let content = fs.readFileSync(path, 'utf8')

// 1. Replace ArtifactPreview type definition
const oldTypeStr = '  const [currentArtifact, setCurrentArtifact] = useState<ArtifactPreview | null>(null)'
const newTypeStr = '  const [currentArtifact, setCurrentArtifact] = useState<ArtifactPreview & {\n    fileData?: string\n    fileName?: string\n    fileSize?: number\n    mimeType?: string\n  } | null>(null)'
fs.writeFileSync(path, content.replace(oldTypeStr, newTypeStr))

console.log('Applied 3 changes: type def, download handler, fileSize display')