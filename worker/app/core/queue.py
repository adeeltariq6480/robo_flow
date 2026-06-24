import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Coroutine, Any
from uuid import UUID

from app.config import settings
from app.models.schemas import JobQueue, JobStatus

logger = logging.getLogger(__name__)


@dataclass(order=True)
class QueueItem:
    priority: int
    job_id: UUID = field(compare=False)


class QueueManager:
    """
    Separates jobs into three queues with independent concurrency:
    - interactive: test-run (priority 0, fastest)
    - compare:     model comparison (priority 1)
    - batch:       full dataset auto-label (priority 2, lowest)
    """

    def __init__(self) -> None:
        self._queues: dict[JobQueue, deque[QueueItem]] = {
            JobQueue.INTERACTIVE: deque(),
            JobQueue.COMPARE: deque(),
            JobQueue.BATCH: deque(),
        }
        self._lock = asyncio.Lock()
        self._not_empty = asyncio.Condition(self._lock)
        self._running: dict[JobQueue, int] = {q: 0 for q in JobQueue}
        self._limits: dict[JobQueue, int] = {
            JobQueue.INTERACTIVE: settings.interactive_queue_workers,
            JobQueue.COMPARE: settings.compare_queue_workers,
            JobQueue.BATCH: settings.batch_queue_workers,
        }
        self._processor: Callable[[UUID], Coroutine[Any, Any, None]] | None = None
        self._dispatcher_task: asyncio.Task | None = None

    def set_processor(
        self, fn: Callable[[UUID], Coroutine[Any, Any, None]]
    ) -> None:
        self._processor = fn

    async def start(self) -> None:
        if self._dispatcher_task is None:
            self._dispatcher_task = asyncio.create_task(self._dispatch_loop())
            logger.info("Queue dispatcher started")

    async def stop(self) -> None:
        if self._dispatcher_task:
            self._dispatcher_task.cancel()
            try:
                await self._dispatcher_task
            except asyncio.CancelledError:
                pass
            self._dispatcher_task = None

    async def enqueue(self, job_id: UUID, queue: JobQueue) -> int:
        """Add job to queue. Returns position (1-based)."""
        priority = {JobQueue.INTERACTIVE: 0, JobQueue.COMPARE: 1, JobQueue.BATCH: 2}[
            queue
        ]
        async with self._not_empty:
            self._queues[queue].append(QueueItem(priority=priority, job_id=job_id))
            self._not_empty.notify()
            return len(self._queues[queue])

    async def _dispatch_loop(self) -> None:
        while True:
            async with self._not_empty:
                job_to_run: tuple[UUID, JobQueue] | None = None

                for queue in (JobQueue.INTERACTIVE, JobQueue.COMPARE, JobQueue.BATCH):
                    if (
                        self._queues[queue]
                        and self._running[queue] < self._limits[queue]
                    ):
                        item = self._queues[queue].popleft()
                        self._running[queue] += 1
                        job_to_run = (item.job_id, queue)
                        break

                if job_to_run is None:
                    await self._not_empty.wait()
                    continue

            job_id, queue = job_to_run
            asyncio.create_task(self._run_job(job_id, queue))

    async def _run_job(self, job_id: UUID, queue: JobQueue) -> None:
        try:
            if self._processor:
                await self._processor(job_id)
        except Exception:
            logger.exception("Job %s failed in queue %s", job_id, queue.value)
        finally:
            async with self._not_empty:
                self._running[queue] -= 1
                self._not_empty.notify()

    def queue_stats(self) -> dict[str, dict]:
        return {
            q.value: {
                "pending": len(self._queues[q]),
                "running": self._running[q],
                "max_workers": self._limits[q],
            }
            for q in JobQueue
        }


queue_manager = QueueManager()
