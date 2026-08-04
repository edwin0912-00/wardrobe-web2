function fileKey(file) {
  return [file.name, file.size, file.type, file.lastModified].join(':');
}

export class UploadSelectionStore {
  constructor({ maxGarments = 5 } = {}) {
    this.maxGarments = maxGarments;
    this.person = null;
    this.identityDetail = null;
    this.garments = [];
  }

  setPerson(file) {
    this.person = file ?? null;
  }

  setIdentityDetail(file) {
    this.identityDetail = file ?? null;
  }

  addGarments(files) {
    const existing = new Set(this.garments.map(fileKey));
    const additions = [...files].filter((file) => {
      const key = fileKey(file);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (this.garments.length + additions.length > this.maxGarments) {
      throw new Error(`Можна додати максимум ${this.maxGarments} фото речей.`);
    }
    this.garments.push(...additions);
    return additions.length;
  }

  removeGarment(index) {
    this.garments.splice(index, 1);
  }

  restore({ person = null, identityDetail = null, garments = [] } = {}) {
    this.person = person;
    this.identityDetail = identityDetail;
    this.garments = garments.slice(0, this.maxGarments);
  }

  reset() {
    this.person = null;
    this.identityDetail = null;
    this.garments = [];
  }
}
