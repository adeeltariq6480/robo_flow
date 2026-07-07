import os
import sys
from typing import List, Sequence, Tuple

from huggingface_hub import CommitOperationDelete, HfApi


DEFAULT_REPO_ID = "Adeel6480/robo_flow"
DEFAULT_REPO_TYPES = ("dataset", "model")


def log(message: str) -> None:
    print(f"[HF-CLEANUP] {message}")


def get_token() -> str:
    token = os.getenv("HF_TOKEN", "").strip()
    if not token:
        raise RuntimeError("HF_TOKEN is not set. Export it before running this script.")
    return token


def ensure_repo_exists(api: HfApi, repo_id: str, repo_type: str) -> None:
    try:
        api.repo_info(repo_id=repo_id, repo_type=repo_type)
    except Exception as exc:  # pragma: no cover - runtime guard
        raise RuntimeError(f"Unable to access {repo_type} repo {repo_id}: {exc}") from exc


def list_repo_files(api: HfApi, repo_id: str, repo_type: str) -> List[str]:
    files = api.list_repo_files(repo_id=repo_id, repo_type=repo_type)
    return sorted(files)


def confirm_deletion(repo_id: str, repo_type: str, files: Sequence[str]) -> bool:
    if not files:
        log("No files found")
        return False

    log(f"files found ({repo_type}): {len(files)}")
    for path in files:
        print(f"  - {path}")

    response = input("Type DELETE to confirm deletion of all listed files: ").strip()
    if response != "DELETE":
        log("Confirmation failed. Aborted.")
        return False
    return True


def delete_repo_contents(api: HfApi, repo_id: str, repo_type: str) -> None:
    ensure_repo_exists(api, repo_id, repo_type)
    log(f"repo connected: {repo_type} {repo_id}")

    files = list_repo_files(api, repo_id, repo_type)
    if not files:
        log("No files found")
        return

    log(f"files found: {len(files)}")
    for path in files:
        print(f"  - {path}")

    if not confirm_deletion(repo_id, repo_type, files):
        return

    log("deleting files")
    operations = [CommitOperationDelete(path_in_repo=path) for path in files]
    api.create_commit(
        repo_id=repo_id,
        repo_type=repo_type,
        operations=operations,
        commit_message=f"Remove all contents from {repo_type} repo {repo_id}",
        token=get_token(),
    )
    log("cleanup completed")


def parse_args(argv: Sequence[str]) -> Tuple[str, str]:
    if len(argv) == 1:
        return "all", DEFAULT_REPO_ID

    if len(argv) == 2 and argv[1] in DEFAULT_REPO_TYPES:
        return argv[1], DEFAULT_REPO_ID

    print("Usage: python cleanup_hf_repo_contents.py [dataset|model]")
    sys.exit(2)


def main() -> None:
    repo_type_arg, repo_id = parse_args(sys.argv)

    try:
        token = get_token()
    except RuntimeError as exc:
        log(str(exc))
        sys.exit(1)

    api = HfApi(token=token)

    if repo_type_arg == "all":
        for repo_type in DEFAULT_REPO_TYPES:
            delete_repo_contents(api, repo_id, repo_type)
    else:
        delete_repo_contents(api, repo_id, repo_type_arg)


if __name__ == "__main__":
    main()
