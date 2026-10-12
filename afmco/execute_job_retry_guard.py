# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import hashlib
import inspect
import os
import time

import frappe
import frappe.monitor
from frappe.utils import CallbackManager, background_jobs

CORE_EXECUTE_JOB_SHA256 = "d6a18e125cb60acd0d8bd0ef87bde833e84045d1cc300fdf8be5188f306d0fa2"


def execute_job(site, method, event, job_name, kwargs, user=None, is_async=True, retry=0):
	retval = None

	if is_async:
		frappe.init(site, force=True, is_job=True)
		frappe.connect()
		if os.environ.get("CI"):
			from frappe.tests.utils import toggle_test_mode

			toggle_test_mode(True)

		if user:
			frappe.set_user(user)

	if isinstance(method, str):
		method_name = method
		method = frappe.get_attr(method)
	else:
		method_name = f"{method.__module__}.{method.__qualname__}"

	frappe.local.job = frappe._dict(
		site=site,
		method=method_name,
		job_name=job_name,
		kwargs=kwargs,
		user=user,
		after_job=CallbackManager(),
	)

	for before_job_task in frappe.get_hooks("before_job"):
		frappe.call(before_job_task, method=method_name, kwargs=kwargs, transaction_type="job")

	retried = False
	try:
		retval = method(**kwargs)

	except (frappe.db.InternalError, frappe.RetryBackgroundJobError) as e:
		frappe.db.rollback(chain=True)

		if retry < 5 and (
			isinstance(e, frappe.RetryBackgroundJobError)
			or (frappe.db.is_deadlocked(e) or frappe.db.is_timedout(e))
		):
			frappe.job.after_job.reset()
			frappe.destroy()
			time.sleep(retry + 1)
			retried = True

			return execute_job(site, method, event, job_name, kwargs, is_async=is_async, retry=retry + 1)

		else:
			frappe.log_error(title=method_name)
			raise

	except Exception as e:
		frappe.db.rollback(chain=True)
		frappe.log_error(title=method_name)
		frappe.monitor.add_data_to_monitor(exception=e.__class__.__name__)
		frappe.db.commit(chain=True)
		print(frappe.get_traceback())
		raise

	else:
		frappe.db.commit(chain=True)
		return retval

	finally:
		if not retried:
			if not hasattr(frappe.local, "site"):
				frappe.init(site, force=True, is_job=True)
				frappe.connect()
			for after_job_task in frappe.get_hooks("after_job"):
				frappe.call(after_job_task, method=method_name, kwargs=kwargs, result=retval)
			frappe.local.job.after_job.run()

			if is_async:
				frappe.destroy()


def install():
	core_source = inspect.getsource(background_jobs.execute_job)
	if hashlib.sha256(core_source.encode()).hexdigest() == CORE_EXECUTE_JOB_SHA256:
		background_jobs.execute_job = execute_job
