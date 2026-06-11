# Import every model module so SQLAlchemy registers all tables
# with Base.metadata before create_all() is called.
from apps.auth.models import Tenant, TenantUser  # noqa: F401
from apps.branches.models import TenantBranch  # noqa: F401
from apps.categories.models import Category  # noqa: F401
from apps.currencies.models import TenantCurrency  # noqa: F401
from apps.customers.models import Customer  # noqa: F401
from apps.finance.models import Currency, ExchangeRate  # noqa: F401
from apps.invoices.models import Invoice, PihChain, Submission  # noqa: F401
from apps.notifications.models import Webhook  # noqa: F401
from apps.onboarding.models import CsrConfig, Csid  # noqa: F401
from apps.organizations.models import TenantOrganization  # noqa: F401
from apps.products.models import Product  # noqa: F401
